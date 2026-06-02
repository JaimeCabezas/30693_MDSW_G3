import asyncio
import os

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from passlib.context import CryptContext

load_dotenv()

MONGO_URI = os.getenv("MONGO_URI")
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


async def main():
    client = AsyncIOMotorClient(MONGO_URI)
    db = client.get_database("united_republic_db")

    hashed_password = pwd_context.hash("admin123")

    usuario = {
        "nombre": "Alexis Admin",
        "correo": "alexisadmin@unitedrepublic.com",
        "hashed_password": hashed_password,
        "rol": "superadmin",
    }

    await db["usuarios"].insert_one(usuario)
    print("Usuario semilla creado con éxito")

    client.close()


asyncio.run(main())
