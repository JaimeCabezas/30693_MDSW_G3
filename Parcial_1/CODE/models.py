import re
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, EmailStr, field_validator

Rol = Literal["superadmin", "admin", "traductor"]

_EMAIL_RE = re.compile(r'^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$')

DOMINIOS_PERMITIDOS = {"espe.edu.ec", "gmail.com"}


def _validar_correo(v: str) -> str:
    if not _EMAIL_RE.match(v):
        raise ValueError('Formato de correo electrónico inválido')
    dominio = v.split('@')[-1].lower()
    if dominio not in DOMINIOS_PERMITIDOS:
        raise ValueError('Solo se permiten correos institucionales (@espe.edu.ec) o Gmail (@gmail.com)')
    return v


class Usuario(BaseModel):
    nombre: str
    correo: EmailStr
    rol: Rol


class UsuarioCreate(BaseModel):
    nombre: str
    correo: EmailStr
    rol: Rol
    password: str

    @field_validator('correo')
    @classmethod
    def correo_valido(cls, v: str) -> str:
        return _validar_correo(v)


class DocumentoCreate(BaseModel):
    titulo: str
    idioma_origen: Literal["Ingles", "Español"]
    idioma_destino: Literal["Ingles", "Español"]
    estado: str = "pendiente"
    fecha_entrega: datetime
    costo: Optional[float] = None


class UsuarioUpdate(BaseModel):
    nombre: Optional[str] = None
    correo: Optional[EmailStr] = None
    rol: Optional[Rol] = None
    password: Optional[str] = None

    @field_validator('correo')
    @classmethod
    def correo_valido(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            return _validar_correo(v)
        return v


class DocumentoUpdate(BaseModel):
    titulo: Optional[str] = None
    idioma_origen: Optional[Literal["Ingles", "Español"]] = None
    idioma_destino: Optional[Literal["Ingles", "Español"]] = None
    estado: Optional[str] = None
    fecha_entrega: Optional[datetime] = None
    costo: Optional[float] = None


class Evaluacion(BaseModel):
    aprobado: bool
    feedback: Optional[str] = None


class MensajeChat(BaseModel):
    mensaje: str


class Notificacion(BaseModel):
    usuario_receptor: str
    titulo: str
    mensaje: str
    fecha: str
    leida: bool = False
