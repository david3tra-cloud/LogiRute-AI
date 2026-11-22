# Cierre de DECA

Fecha: 22-11-2026.

## Integración

- PR #21 incorporó la conservación de identidades de empresas, el campo opcional `destinatario_nif` en CSV y la carga del transportista predeterminado con aislamiento de catálogo, almacenamiento local y formularios entre usuarios.
- PR #20 incorporó el paso masivo de DECA seleccionados a ruta, con procesamiento secuencial, resumen de resultados y reintento de fallidos.
- Ambas PR están fusionadas en `main`. SHA comprobado de `main`: `96226fa704f03f7fbe84f6516d1e6ade22d3f668`.
- Las ramas `feat/deca-bulk-add-to-routes` y `fix/deca-identities-default-carrier`, tanto locales como remotas, están integradas en `origin/main` y se conservan deliberadamente. No se han eliminado.

## Comprobaciones manuales comunicadas por el usuario

El usuario confirma que el despliegue funciona y que comprobó:

- Creación individual y masiva con transportista predeterminado.
- Importación de un CSV de aproximadamente 30–31 filas.
- Creación y emisión de los DECA.
- Paso de 30 DECA a ruta en una sola operación.
- Aislamiento entre cuentas, comprobado previamente.

## Validaciones automatizadas previas

Estas son validaciones locales comunicadas antes de la fusión en `main`; no se ejecutaron durante esta sesión de cierre documental. Se usaron servicios simulados, sin E2E contra Supabase real:

- Vitest: 41 pruebas aprobadas en 5 archivos, incluyendo las suites de paso masivo a ruta, identidades y transportista.
- Regresiones CSV aprobadas.
- Pruebas de empresas: 37/37 y 10/10 aprobadas.
- Typechecks general, E2E, integración DECA/transportista y específico de paso masivo a ruta aprobados.
- `npm run build` y `git diff --check` aprobados. El build informó un chunk mayor de 500 kB.

No se ejecutaron emisiones, sincronización, migraciones ni operaciones contra servicios de negocio durante estas validaciones.
