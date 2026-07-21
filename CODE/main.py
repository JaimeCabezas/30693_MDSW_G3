import io
import os
import shutil
import smtplib
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import PyPDF2

from bson import ObjectId
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, Request, UploadFile, WebSocket, WebSocketDisconnect
from urllib.parse import unquote
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import ConnectionFailure
from passlib.context import CryptContext
import jwt

from models import ConfiguracionCosto, DocumentoCreate, DocumentoUpdate, Evaluacion, MensajeChat, Notificacion, Usuario, UsuarioCreate, UsuarioUpdate

# Cargar las variables del archivo .env
load_dotenv()

MONGO_URI = "mongodb+srv://admin_united:alexis123@cluster0.hpqxqtg.mongodb.net/?appName=Cluster0"
SECRET_KEY = os.getenv("SECRET_KEY", "cambia_esta_clave_en_produccion")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")

# ── Configuración SMTP (variables de entorno; sin ellas el envío queda pendiente) ──
SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASS = os.getenv("SMTP_PASS", "")


async def enviar_correo_verificacion(destinatario: str, nombre: str) -> None:
    """Esqueleto de envío de correo de confirmación de cuenta.

    Requiere SMTP_USER y SMTP_PASS definidos en .env para funcionar.
    Mientras no estén configurados, registra el intento y retorna sin error.
    """
    if not SMTP_USER or not SMTP_PASS:
        print(f"[EMAIL] SMTP no configurado — correo de verificación pendiente para {destinatario}")
        return

    mensaje = MIMEMultipart("alternative")
    mensaje["Subject"] = "Confirma tu cuenta — United Republic"
    mensaje["From"] = SMTP_USER
    mensaje["To"] = destinatario

    cuerpo_html = f"""
    <html><body>
      <h2>Hola {nombre},</h2>
      <p>Tu cuenta en <strong>United Republic</strong> ha sido creada.</p>
      <p>Por favor confirma tu correo haciendo clic en el enlace que recibirás próximamente.</p>
    </body></html>
    """
    mensaje.attach(MIMEText(cuerpo_html, "html"))

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as servidor:
            servidor.starttls()
            servidor.login(SMTP_USER, SMTP_PASS)
            servidor.sendmail(SMTP_USER, destinatario, mensaje.as_string())
        print(f"[EMAIL] Correo de verificación enviado a {destinatario}")
    except Exception as exc:
        print(f"[EMAIL] Error al enviar correo a {destinatario}: {exc}")


# Gestor de ciclo de vida del servidor
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Crear carpeta de subidas al iniciar si no existe
    os.makedirs("uploads", exist_ok=True)
    
    app.state.mongo_client = AsyncIOMotorClient(MONGO_URI)
    app.state.db = app.state.mongo_client.get_database("united_republic_db")
    yield
    app.state.mongo_client.close()

# Creación de la aplicación FastAPI
app = FastAPI(title="United Republic API", lifespan=lifespan)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    primer_error = exc.errors()[0]
    mensaje = primer_error.get("msg", "Error de validación")
    return JSONResponse(status_code=400, content={"detail": mensaje})


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

os.makedirs('uploads', exist_ok=True)

intentos_login = {}


# ==========================================
# 0b. DESCARGA DE ARCHIVOS (/uploads)
# ==========================================

UPLOADS_DIR = os.path.abspath("uploads")


@app.get("/uploads/{nombre_archivo:path}")
async def descargar_archivo(nombre_archivo: str):
    """Sirve archivos subidos, decodificando espacios/tildes (%20, etc.) del nombre."""
    nombre_decodificado = unquote(nombre_archivo)

    ruta_completa = os.path.abspath(os.path.join(UPLOADS_DIR, nombre_decodificado))
    # Evita path traversal (ej. "../../"): la ruta final debe seguir dentro de uploads/
    if not ruta_completa.startswith(UPLOADS_DIR + os.sep):
        raise HTTPException(status_code=404, detail="Archivo no encontrado")

    if not os.path.isfile(ruta_completa):
        return JSONResponse(
            status_code=404,
            content={
                "error": "El archivo físico expiró en el servidor temporal. Vuelva a subirlo para esta demostración."
            },
        )

    return FileResponse(ruta_completa, filename=os.path.basename(ruta_completa))


# ==========================================
# 0. WEBSOCKETS - GESTOR DE CONEXIONES
# ==========================================

class ConnectionManager:
    def __init__(self):
        self.conexiones_activas: dict[str, WebSocket] = {}

    def conectar(self, websocket: WebSocket, correo: str):
        self.conexiones_activas[correo] = websocket

    def desconectar(self, correo: str):
        self.conexiones_activas.pop(correo, None)

    async def notificar(self, correo: str, data: dict):
        ws = self.conexiones_activas.get(correo)
        if ws:
            try:
                await ws.send_json(data)
            except Exception:
                self.desconectar(correo)

manager = ConnectionManager()


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, correo: str = Query(...)):
    await websocket.accept()
    correo = unquote(correo)
    manager.conectar(websocket, correo)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.desconectar(correo)


# ==========================================
# 1. DEPENDENCIAS Y SEGURIDAD (El "Guardia")
# ==========================================

async def obtener_usuario_actual(request: Request, token: str = Depends(oauth2_scheme)):
    credenciales_exc = HTTPException(
        status_code=401,
        detail="No se pudo validar el token",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        correo: str = payload.get("sub")
        if correo is None:
            raise credenciales_exc
    except jwt.ExpiredSignatureError:
        raise credenciales_exc
    except jwt.PyJWTError:
        raise credenciales_exc

    usuario = await request.app.state.db["usuarios"].find_one({"correo": correo})
    if usuario is None:
        raise credenciales_exc

    usuario.pop("hashed_password", None)
    usuario["_id"] = str(usuario["_id"])
    return usuario


def requerir_rol(roles_permitidos: list):
    async def verificador(usuario: dict = Depends(obtener_usuario_actual)):
        if usuario["rol"] not in roles_permitidos:
            raise HTTPException(status_code=403, detail="No tienes permisos para esta acción")
        return usuario
    return verificador


async def registrar_log(correo_usuario: str, accion: str, detalles: str = ''):
    log = {
        "usuario": correo_usuario,
        "accion": accion,
        "detalles": detalles,
        "fecha": datetime.now().isoformat(),
    }
    await app.state.db["auditoria"].insert_one(log)


# ==========================================
# 2. RUTAS Y ENDPOINTS - USUARIOS
# ==========================================

@app.get("/")
async def root():
    return {"mensaje": "API de United Republic en linea"}


@app.post("/usuarios")
async def crear_usuario(request: Request, usuario: UsuarioCreate, usuario_actual: dict = Depends(requerir_rol(["superadmin"]))):
    nuevo_usuario = usuario.model_dump()
    nuevo_usuario["hashed_password"] = pwd_context.hash(nuevo_usuario.pop("password"))
    nuevo_usuario["is_verified"] = False
    await request.app.state.db["usuarios"].insert_one(nuevo_usuario)
    await enviar_correo_verificacion(nuevo_usuario["correo"], nuevo_usuario["nombre"])
    return {"mensaje": "Usuario creado exitosamente"}


@app.post("/login")
async def login(request: Request, form_data: OAuth2PasswordRequestForm = Depends()):
    registro = intentos_login.get(form_data.username)
    if registro:
        if registro["bloqueado_hasta"] and registro["bloqueado_hasta"] > datetime.now():
            raise HTTPException(status_code=429, detail="Demasiados intentos fallidos. Cuenta bloqueada por 5 minutos.")
        if registro["bloqueado_hasta"] and registro["bloqueado_hasta"] <= datetime.now():
            intentos_login[form_data.username]["intentos"] = 0
            intentos_login[form_data.username]["bloqueado_hasta"] = None

    db_usuario = await request.app.state.db["usuarios"].find_one({"correo": form_data.username})
    if not db_usuario or not pwd_context.verify(form_data.password, db_usuario["hashed_password"]):
        entrada = intentos_login.setdefault(form_data.username, {"intentos": 0, "bloqueado_hasta": None})
        entrada["intentos"] += 1
        if entrada["intentos"] >= 3:
            entrada["bloqueado_hasta"] = datetime.now() + timedelta(minutes=5)
        raise HTTPException(status_code=401, detail="Credenciales incorrectas")

    intentos_login.pop(form_data.username, None)

    expiracion = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {"sub": db_usuario["correo"], "rol": db_usuario["rol"], "exp": expiracion}
    token = jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)

    return {"access_token": token, "token_type": "bearer"}


@app.get("/usuarios/me")
async def obtener_mi_usuario(usuario_actual: dict = Depends(obtener_usuario_actual)):
    return usuario_actual


@app.get("/usuarios")
async def obtener_usuarios(request: Request):
    usuarios = await request.app.state.db["usuarios"].find().to_list(length=100)
    for usuario in usuarios:
        usuario["_id"] = str(usuario["_id"])
    return usuarios


@app.put("/usuarios/{usuario_id}")
async def actualizar_usuario(request: Request, usuario_id: str, datos: UsuarioUpdate, usuario_actual: dict = Depends(requerir_rol(["superadmin"]))):
    campos = datos.model_dump(exclude_unset=True)
    if "password" in campos:
        campos["hashed_password"] = pwd_context.hash(campos.pop("password"))
    resultado = await request.app.state.db["usuarios"].update_one(
        {"_id": ObjectId(usuario_id)},
        {"$set": campos}
    )
    if resultado.matched_count == 0:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return {"mensaje": "Usuario actualizado exitosamente"}


@app.delete("/usuarios/{usuario_id}")
async def eliminar_usuario(request: Request, usuario_id: str, usuario_actual: dict = Depends(requerir_rol(["superadmin"]))):
    resultado = await request.app.state.db["usuarios"].delete_one({"_id": ObjectId(usuario_id)})
    if resultado.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return {"mensaje": "Usuario eliminado exitosamente"}


# ==========================================
# 3. RUTAS Y ENDPOINTS - DOCUMENTOS
# ==========================================

@app.post("/documentos")
async def crear_documento(
    request: Request,
    titulo: str = Form(...),
    idioma_origen: str = Form(...),
    idioma_destino: str = Form(...),
    fecha_entrega: str = Form(...),
    asignado_a: str = Form(...),
    comentarios: str = Form(""),
    archivo_origen: UploadFile = File(...),
    usuario_actual: dict = Depends(obtener_usuario_actual),
):
    if archivo_origen.content_type not in [
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]:
        raise HTTPException(status_code=400, detail="Formato no permitido. Solo PDF o Word.")

    contenido = await archivo_origen.read()

    nombre_archivo = f"origen_{titulo.replace(' ', '_')}_{archivo_origen.filename}"
    ruta_origen = os.path.join("uploads", nombre_archivo)
    with open(ruta_origen, "wb") as buffer:
        buffer.write(contenido)

    # Contar páginas para calcular el costo automáticamente
    num_paginas = 1
    if archivo_origen.content_type == "application/pdf":
        try:
            lector = PyPDF2.PdfReader(io.BytesIO(contenido))
            num_paginas = len(lector.pages)
        except Exception:
            num_paginas = 1

    config = await request.app.state.db["configuracion"].find_one({"tipo": "costo"})
    costo_por_pagina = config["costo_por_pagina"] if config else 5.00
    costo = num_paginas * costo_por_pagina

    nuevo_documento = {
        "titulo": titulo,
        "idioma_origen": idioma_origen,
        "idioma_destino": idioma_destino,
        "fecha_entrega": datetime.fromisoformat(fecha_entrega),
        "asignado_a": asignado_a,
        "comentarios": comentarios,
        "estado": "Pendiente",
        "fecha_envio": datetime.now(timezone.utc),
        "archivo_origen_url": ruta_origen,
        "archivo_traduccion_url": None,
        "creado_por": usuario_actual["correo"],
        "mensajes": [],
        "costo": costo,
    }

    await request.app.state.db["documentos"].insert_one(nuevo_documento)
    await registrar_log(usuario_actual["correo"], "Crear Documento", f"Título: {titulo}")
    return {"mensaje": "Documento creado exitosamente"}


@app.get("/documentos")
async def obtener_documentos(request: Request, usuario_actual: dict = Depends(obtener_usuario_actual)):
    if usuario_actual["rol"] in ("superadmin", "admin"):
        filtro = {}
    else:
        filtro = {"asignado_a": usuario_actual["correo"]}

    documentos = await request.app.state.db["documentos"].find(filtro).to_list(length=100)

    for doc in documentos:
        doc["_id"] = str(doc["_id"])
        if usuario_actual["rol"] == "traductor":
            doc.pop("costo", None)

    return documentos


@app.put("/documentos/{documento_id}")
async def actualizar_documento(request: Request, documento_id: str, datos: DocumentoUpdate, usuario_actual: dict = Depends(obtener_usuario_actual)):
    documento = await request.app.state.db["documentos"].find_one({"_id": ObjectId(documento_id)})
    if documento is None:
        raise HTTPException(status_code=404, detail="Documento no encontrado")
    if usuario_actual["rol"] == "traductor" and documento.get("asignado_a") != usuario_actual["correo"]:
        raise HTTPException(status_code=403, detail="No tienes permisos para esta acción")

    campos = datos.model_dump(exclude_unset=True)
    if usuario_actual["rol"] == "traductor":
        campos.pop("costo", None)
    await request.app.state.db["documentos"].update_one(
        {"_id": ObjectId(documento_id)},
        {"$set": campos}
    )
    return {"mensaje": "Documento actualizado exitosamente"}


@app.delete("/documentos/{documento_id}")
async def eliminar_documento(request: Request, documento_id: str, usuario_actual: dict = Depends(obtener_usuario_actual)):
    documento = await request.app.state.db["documentos"].find_one({"_id": ObjectId(documento_id)})
    if documento is None:
        raise HTTPException(status_code=404, detail="Documento no encontrado")
    if usuario_actual["rol"] == "traductor" and documento.get("asignado_a") != usuario_actual["correo"]:
        raise HTTPException(status_code=403, detail="No tienes permisos para esta acción")

    await request.app.state.db["documentos"].delete_one({"_id": ObjectId(documento_id)})
    return {"mensaje": "Documento eliminado exitosamente"}


@app.post("/documentos/{documento_id}/traduccion")
async def subir_traduccion(
    request: Request,
    documento_id: str,
    archivo: UploadFile = File(...),
    usuario_actual: dict = Depends(obtener_usuario_actual),
):
    if archivo.content_type not in [
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]:
        raise HTTPException(status_code=400, detail="Formato no permitido. Solo PDF o Word.")

    db_doc = await request.app.state.db["documentos"].find_one({"_id": ObjectId(documento_id)})
    if not db_doc:
        raise HTTPException(status_code=404, detail="Documento no encontrado")

    if usuario_actual["rol"] == "traductor" and db_doc.get("asignado_a") != usuario_actual["correo"]:
        raise HTTPException(status_code=403, detail="No tienes permisos para este documento")

    nombre_archivo = f"trad_{documento_id}_{archivo.filename}"
    ruta_guardado = os.path.join("uploads", nombre_archivo)
    with open(ruta_guardado, "wb") as buffer:
        shutil.copyfileobj(archivo.file, buffer)

    await request.app.state.db["documentos"].update_one(
        {"_id": ObjectId(documento_id)},
        {"$set": {"archivo_traduccion_url": ruta_guardado, "estado": "En revisión"}}
    )
    await registrar_log(usuario_actual["correo"], "Subir Traducción", f"Doc ID: {documento_id}")
    return {"mensaje": "Traducción subida exitosamente", "ruta": ruta_guardado}


@app.put("/documentos/{documento_id}/iniciar")
async def iniciar_documento(request: Request, documento_id: str, usuario_actual: dict = Depends(obtener_usuario_actual)):
    documento = await request.app.state.db["documentos"].find_one({"_id": ObjectId(documento_id)})
    if documento is None:
        raise HTTPException(status_code=404, detail="Documento no encontrado")
    if usuario_actual["rol"] == "traductor" and documento.get("asignado_a") != usuario_actual["correo"]:
        raise HTTPException(status_code=403, detail="No tienes permisos para esta acción")

    await request.app.state.db["documentos"].update_one(
        {"_id": ObjectId(documento_id)},
        {"$set": {"estado": "En proceso"}}
    )
    await registrar_log(usuario_actual["correo"], "Iniciar Traducción", f"Doc ID: {documento_id}")
    return {"mensaje": "Documento marcado como 'En proceso'"}


@app.put("/documentos/{documento_id}/evaluar")
async def evaluar_documento(request: Request, documento_id: str, evaluacion: Evaluacion, usuario_actual: dict = Depends(requerir_rol(["superadmin", "admin"]))):
    documento = await request.app.state.db["documentos"].find_one({"_id": ObjectId(documento_id)})
    if documento is None:
        raise HTTPException(status_code=404, detail="Documento no encontrado")

    if evaluacion.aprobado:
        campos = {"estado": "Completado"}
    else:
        feedback_text = f"CORRECCIÓN REQUERIDA: {evaluacion.feedback or ''}"
        campos = {
            "estado": "Pendiente",
            "comentarios": feedback_text,
        }

    await request.app.state.db["documentos"].update_one(
        {"_id": ObjectId(documento_id)},
        {"$set": campos}
    )
    await registrar_log(usuario_actual["correo"], "Evaluar Documento", f"Doc ID: {documento_id}, Aprobado: {evaluacion.aprobado}")
    return {"mensaje": "Evaluación registrada exitosamente"}


# ==========================================
# 4. RUTAS Y ENDPOINTS - CHAT
# ==========================================

@app.get("/documentos/{documento_id}/chat")
async def obtener_chat(request: Request, documento_id: str, usuario_actual: dict = Depends(obtener_usuario_actual)):
    documento = await request.app.state.db["documentos"].find_one({"_id": ObjectId(documento_id)})
    if documento is None:
        raise HTTPException(status_code=404, detail="Documento no encontrado")
    return documento.get("mensajes", [])


@app.post("/documentos/{documento_id}/chat")
async def enviar_mensaje(request: Request, documento_id: str, datos: MensajeChat, usuario_actual: dict = Depends(obtener_usuario_actual)):
    documento = await request.app.state.db["documentos"].find_one({"_id": ObjectId(documento_id)})
    if documento is None:
        raise HTTPException(status_code=404, detail="Documento no encontrado")

    nuevo_mensaje = {
        "remitente": usuario_actual["correo"],
        "mensaje": datos.mensaje,
        "fecha": datetime.now().isoformat(),
    }
    await request.app.state.db["documentos"].update_one(
        {"_id": ObjectId(documento_id)},
        {"$push": {"mensajes": nuevo_mensaje}}
    )

    # Persistir notificación y emitir WebSocket al receptor
    remitente = usuario_actual["correo"]
    titulo_doc = documento.get("titulo", "documento")
    posibles_receptores = {documento.get("asignado_a"), documento.get("creado_por")}
    for receptor in posibles_receptores:
        if receptor and receptor != remitente:
            ahora = datetime.now().isoformat()
            notif = {
                "usuario_receptor": receptor,
                "titulo": "Nuevo mensaje en el chat",
                "mensaje": f"Nuevo mensaje en {titulo_doc}",
                "fecha": ahora,
                "leida": False,
            }
            resultado_insert = await request.app.state.db["notificaciones"].insert_one(notif)
            await manager.notificar(receptor, {
                "tipo": "nueva_alerta",
                "id": str(resultado_insert.inserted_id),
                "titulo": notif["titulo"],
                "mensaje": notif["mensaje"],
            })

    return {"mensaje": "Mensaje enviado exitosamente"}


# ==========================================
# 5. RUTAS Y ENDPOINTS - ALERTAS
# ==========================================

@app.get("/alertas")
async def obtener_alertas(request: Request, usuario_actual: dict = Depends(obtener_usuario_actual)):
    alertas = []

    if usuario_actual["rol"] == "traductor":
        documentos = await request.app.state.db["documentos"].find(
            {"asignado_a": usuario_actual["correo"]}
        ).to_list(length=1000)

        for doc in documentos:
            # Regla 1: Nuevo pedido pendiente
            if doc.get("estado") == "Pendiente":
                alertas.append({
                    "titulo": "Nuevo Pedido",
                    "mensaje": f"Tienes un nuevo documento asignado: {doc.get('titulo')}",
                })

            # Regla 2: Plazo próximo o vencido
            try:
                fecha_entrega = doc.get("fecha_entrega")
                if isinstance(fecha_entrega, str):
                    fecha_entrega = datetime.fromisoformat(fecha_entrega)
                diferencia = fecha_entrega - datetime.now()
                if diferencia < timedelta(days=1) and doc.get("estado") != "Completado":
                    alertas.append({
                        "titulo": "¡Plazo próximo!",
                        "mensaje": f"El encargo {doc.get('titulo')} vence pronto.",
                    })
            except Exception:
                pass

    else:
        # Admin / superadmin: documentos no completados con entrega en menos de 24 h
        documentos = await request.app.state.db["documentos"].find(
            {"estado": {"$ne": "Completado"}}
        ).to_list(length=1000)

        for doc in documentos:
            try:
                fecha_entrega = doc.get("fecha_entrega")
                if isinstance(fecha_entrega, str):
                    fecha_entrega = datetime.fromisoformat(fecha_entrega)
                diferencia = fecha_entrega - datetime.now()
                if diferencia < timedelta(days=1):
                    alertas.append({
                        "titulo": "Fecha crítica",
                        "mensaje": f"El documento '{doc.get('titulo')}' vence pronto.",
                    })
            except Exception:
                pass

    return alertas


# ==========================================
# 5b. RUTAS Y ENDPOINTS - NOTIFICACIONES DE CHAT
# ==========================================

@app.get("/notificaciones")
async def obtener_notificaciones(request: Request, usuario_actual: dict = Depends(obtener_usuario_actual)):
    notifs = await request.app.state.db["notificaciones"].find(
        {"usuario_receptor": usuario_actual["correo"], "leida": False}
    ).sort("fecha", -1).to_list(length=50)
    for n in notifs:
        n["_id"] = str(n["_id"])
    return notifs


@app.patch("/notificaciones/leer-todas")
async def marcar_todas_notificaciones_leidas(request: Request, usuario_actual: dict = Depends(obtener_usuario_actual)):
    await request.app.state.db["notificaciones"].update_many(
        {"usuario_receptor": usuario_actual["correo"], "leida": False},
        {"$set": {"leida": True}},
    )
    return {"mensaje": "Notificaciones marcadas como leidas"}


@app.patch("/notificaciones/{notificacion_id}/leer")
async def marcar_notificacion_leida(request: Request, notificacion_id: str, usuario_actual: dict = Depends(obtener_usuario_actual)):
    try:
        oid = ObjectId(notificacion_id)
    except Exception:
        raise HTTPException(status_code=400, detail="ID de notificacion invalido")

    resultado = await request.app.state.db["notificaciones"].update_one(
        {"_id": oid, "usuario_receptor": usuario_actual["correo"]},
        {"$set": {"leida": True}},
    )
    if resultado.matched_count == 0:
        raise HTTPException(status_code=404, detail="Notificacion no encontrada")
    return {"mensaje": "Notificacion marcada como leida"}


# ==========================================
# 6. RUTAS Y ENDPOINTS - ESTADÍSTICAS
# ==========================================

@app.get("/estadisticas")
async def obtener_estadisticas(request: Request, usuario_actual: dict = Depends(requerir_rol(["superadmin", "admin"]))):
    documentos = await request.app.state.db["documentos"].find().to_list(length=None)

    total_documentos = len(documentos)
    pendientes = sum(1 for d in documentos if d.get("estado") == "Pendiente")
    en_proceso = sum(1 for d in documentos if d.get("estado") == "En proceso")
    en_revision = sum(1 for d in documentos if d.get("estado") == "En revisión")
    completados = sum(1 for d in documentos if d.get("estado") == "Completado")

    ganancias_totales = 0.0
    for doc in documentos:
        if doc.get("estado") == "Completado":
            costo = doc.get("costo")
            if costo is not None:
                try:
                    ganancias_totales += float(str(costo).replace("$", "").strip())
                except (ValueError, TypeError):
                    pass

    return {
        "total_documentos": total_documentos,
        "pendientes": pendientes,
        "en_proceso": en_proceso,
        "en_revision": en_revision,
        "completados": completados,
        "ganancias_totales": ganancias_totales,
    }


# ==========================================
# 7. RUTAS Y ENDPOINTS - AUDITORÍA
# ==========================================

@app.get("/auditoria")
async def obtener_auditoria(request: Request, usuario_actual: dict = Depends(requerir_rol(["superadmin", "admin"]))):
    logs = await request.app.state.db["auditoria"].find().sort("fecha", -1).to_list(length=None)
    for log in logs:
        log["_id"] = str(log["_id"])
    return logs


@app.delete("/auditoria/{log_id}")
async def eliminar_log_auditoria(request: Request, log_id: str, usuario_actual: dict = Depends(requerir_rol(["superadmin"]))):
    resultado = await request.app.state.db["auditoria"].delete_one({"_id": ObjectId(log_id)})
    if resultado.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Registro no encontrado")
    return {"mensaje": "Registro eliminado exitosamente"}


# ==========================================
# 8. RUTAS Y ENDPOINTS - CONFIGURACIÓN
# ==========================================

@app.get("/configuracion/costo")
async def obtener_configuracion_costo(request: Request, usuario_actual: dict = Depends(obtener_usuario_actual)):
    config = await request.app.state.db["configuracion"].find_one({"tipo": "costo"})
    if not config:
        return {"costo_por_pagina": 5.00}
    return {"costo_por_pagina": config["costo_por_pagina"]}


@app.put("/configuracion/costo")
async def actualizar_configuracion_costo(request: Request, datos: ConfiguracionCosto, usuario_actual: dict = Depends(requerir_rol(["superadmin"]))):
    await request.app.state.db["configuracion"].update_one(
        {"tipo": "costo"},
        {"$set": {"tipo": "costo", "costo_por_pagina": datos.costo_por_pagina}},
        upsert=True,
    )
    return {"mensaje": "Costo actualizado exitosamente", "costo_por_pagina": datos.costo_por_pagina}


# ==========================================
# 9. RUTAS Y ENDPOINTS - HEALTH CHECK (REQ009)
# ==========================================

@app.get("/health/db")
async def verificar_estado_base_datos(simular_caida: bool = False):
    
    if simular_caida:
        raise HTTPException(status_code=503, detail="Base de datos inalcanzable (Simulada)")

    try:
        await app.state.mongo_client.admin.command('ping')
        return {"estado": "ok", "mensaje": "Conexión a MongoDB exitosa"}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Fallo crítico de conexión: {str(e)}")