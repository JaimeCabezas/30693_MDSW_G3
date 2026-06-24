import asyncio
import os

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from passlib.context import CryptContext

load_dotenv()

MONGO_URI = os.getenv(
    "MONGO_URI",
    "mongodb+srv://admin_united:alexis123@cluster0.hpqxqtg.mongodb.net/?appName=Cluster0",
)
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


async def main():
    client = AsyncIOMotorClient(MONGO_URI)
    db = client.get_database("united_republic_db")

    resultado = await db["usuarios"].delete_many({})
    print(f"Coleccion limpiada: {resultado.deleted_count} usuario(s) eliminado(s)")

    password_hash = pwd_context.hash("admin123")

    usuarios = [
        {
            "nombre": "Alexis",
            "correo": "ur.presidencia@gmail.com",
            "hashed_password": password_hash,
            "rol": "admin",
            "is_verified": True,
        },
        {
            "nombre": "Jaime",
            "correo": "jacabezas13@espe.edu.ec",
            "hashed_password": password_hash,
            "rol": "traductor",
            "is_verified": True,
        },
        {
            "nombre": "Bryan",
            "correo": "bacevallos1@espe.edu.ec",
            "hashed_password": password_hash,
            "rol": "traductor",
            "is_verified": True,
        },
        {
            "nombre": "Jelen",
            "correo": "jdlucio@espe.edu.ec",
            "hashed_password": password_hash,
            "rol": "traductor",
            "is_verified": True,
        },
    ]

    await db["usuarios"].insert_many(usuarios)
    print(f"{len(usuarios)} usuario(s) semilla insertados:")
    for u in usuarios:
        print(f"  - {u['nombre']} <{u['correo']}> — rol: {u['rol']} | verificado: {u['is_verified']}")

    client.close()


asyncio.run(main())
