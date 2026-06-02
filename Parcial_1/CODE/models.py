from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, EmailStr

Rol = Literal["superadmin", "admin", "traductor"]


class Usuario(BaseModel):
    nombre: str
    correo: EmailStr
    rol: Rol


class UsuarioCreate(BaseModel):
    nombre: str
    correo: EmailStr
    rol: Rol
    password: str


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
