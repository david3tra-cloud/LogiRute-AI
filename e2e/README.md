## Banco E2E de navegación: alcance y limitaciones

Validación local del 21 de noviembre de 2026:

- 13 pruebas correctas: login simulado y 12 casos de navegación.
- Typecheck de aplicación y E2E sin errores.
- Ejecución en Chromium con autenticación y datos simulados.
- No valida aspecto visual, emisión real ni producción.

Límites conocidos:

- T1: el último Atrás solo comprueba Inicio si la URL no cambia.
- T2: tras cerrar CSV y retroceder, comprueba ausencia de modal
  y reducción de profundidad, pero no el módulo anterior exacto.
- T3: comprueba profundidad estable tras dos clics y cambio de módulo
  al retroceder; no mide la longitud real del historial.
- T5: exige abandonar detail, pero no exige explícitamente list.
- T6: solo cubre navegación sin operación activa; no prueba el bloqueo
  durante una operación en curso.
- T10: cubre Empresas tras recarga y entrada simulada con history.state,
  no Transportistas ni un historial externo preparado expresamente.
- Los diagnósticos adicionales del código se limitan al login y T3.
- hasServer no comprueba disponibilidad real del servidor.
- Las trazas de la ejecución de hoy no se han inspeccionado.
