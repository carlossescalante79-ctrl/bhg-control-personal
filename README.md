# BHG Control de Personal - versión funcional

## Variables en Vercel
- DATABASE_URL = conexión de Neon
- SESSION_SECRET = una frase larga aleatoria
- SETUP_KEY = una clave temporal para inicializar la base

## Primer despliegue
1. Sube esta carpeta a un repositorio GitHub o importa el proyecto a Vercel.
2. Agrega las 3 variables de entorno.
3. Despliega.
4. Ejecuta una sola vez el setup con POST a /api/setup agregando header `x-setup-key` con el valor de SETUP_KEY.
   Ejemplo con curl:
   curl -X POST https://TU-DOMINIO.vercel.app/api/setup -H "x-setup-key: TU_SETUP_KEY"
5. Abre /terminal.

## PIN inicial
- Administrador: 9999
- Juan demo: 1234
- Luis demo: 5678

Cambia el PIN del administrador desde el panel al terminar las pruebas.

## QR fijo
El panel muestra un QR generado por `/api/qr` que apunta a `/registro`.
Imprímelo una sola vez y pégalo en el taller.

## Cámara
La cámara funciona al estar publicado por HTTPS (Vercel). La foto se comprime en el navegador y se guarda en Neon como evidencia.
Prueba de conexión GitHub - Vercel
