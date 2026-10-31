# Relevo: Registro → Facturación

Fecha de actualización: 31-10-2026, 22:59.

Estado basado en los informes del workspace local, los fragmentos de código y las salidas de terminal revisados, las consultas realizadas mediante el conector de Supabase y las comprobaciones manuales del usuario.

Las dos migraciones de esta ampliación ya están aplicadas en Supabase. Los cambios de la aplicación permanecen locales, sin commit, push ni despliegue realizados durante esta sesión.

No confundir las pruebas locales simuladas con validación real del servidor. Distinguir también las propuestas de los agentes de los cambios efectivamente guardados.

## Objetivo y comportamiento

Seguimiento mensual de actividad pendiente de tarifas, sin importes ni facturas fiscales.

Las tarifas por entregas, recogidas, kilos y kilómetros se incorporarán cuando el usuario disponga de ellas.

El resumen enviado a Facturación queda como una instantánea persistente e inmutable, independiente del resumen de origen.

El envío es idempotente por usuario y jornada. La interfaz solo muestra éxito tras confirmación remota.

El borrado del resumen en Registro es una acción aparte y no elimina la instantánea de Facturación.

La fecha mensual deriva de `fecha_cierre AT TIME ZONE 'Europe/Madrid'`. También se conserva el instante original del cierre.

## Funcionalidad implementada

### Detalle en Facturación

Se añadió un detalle desplegable para consultar la información disponible en la instantánea: entregas, recogidas, destinos, direcciones, estados, observaciones y orden de ruta.

El detalle utiliza `billing_daily_records.snapshot`, sin depender de que siga existiendo el resumen de origen.

El usuario confirmó manualmente que el desplegable funciona.

Las instantáneas ya enviadas no se modifican ni se enriquecen retroactivamente.

### Kilometraje

Se añadieron campos de cuentakilómetros inicial y final en Control de la jornada.

Las nuevas jornadas deben exigir ambas lecturas para cerrar, con validación de valores no negativos y lectura final no inferior a la inicial.

Los kilómetros recorridos son la diferencia entre ambas lecturas, no una distancia calculada mediante GPS.

El modelo aplicado vincula el kilometraje a `(user_id, source_jornada_id)`:

- Un trigger crea el estado `PENDIENTE` al insertar una jornada en `registro_jornadas`.
- La finalización autenticada exige ambas lecturas y pasa el estado a `COMPLETA`.
- Una captura definitiva es inmutable.
- Un reintento con lecturas idénticas es idempotente.
- Facturación bloquea el primer envío de jornadas cuyo kilometraje sigue `PENDIENTE`.
- Las jornadas que ya existían en el servidor antes de instalar esta migración no tienen fila de estado y se consideran históricas sin kilometraje.

La asociación no utiliza comparaciones temporales para deducir a qué jornada pertenecen las lecturas.

El usuario comprobó una jornada nueva con lecturas `1000 → 1025 km`:

- El cierre terminó.
- El resumen apareció en nube con `25 km recorridos`.
- El envío a Facturación conservó ambas lecturas y los 25 km.
- El acumulado mensual indicó correctamente que faltaba kilometraje en una jornada antigua.

### Kilos procedentes de DeCAs

Según la revisión local:

- DeCA conserva `pesoKg` como dato estructurado.
- Al convertirlo en parada, se copia a un campo propio sin alterar las observaciones.
- Para datos históricos, solo se reconoce el formato generado por la aplicación `Peso: N kg`, con una única etiqueta y origen DeCA identificado.
- Otros formatos quedan visibles en las observaciones, sin interpretarse ni sumarse automáticamente.
- No se inspeccionaron observaciones reales del servicio remoto para ampliar los formatos reconocidos.

Los datos ausentes no deben interpretarse como cero ni presentar acumulados parciales como completos.

La captura de Facturación aportada por el usuario mostró:

- 116 kg de entregas planificados en seis paradas con peso.
- 86 kg correspondientes a cinco paradas completadas con peso.
- Distinción entre actividad planificada y realizada.

Esta observación confirma la presentación de esos valores en la prueba, no una validación de todos los formatos posibles de peso.

## Archivos afectados

Según los informes y el estado local comunicado. Revisar `git status --short` para obtener la lista actual antes de continuar.

Modificados:

- `App.tsx`
- `BillingSection.tsx`
- `RegistroNubeModal.tsx`
- `RouteCloudPanel.tsx`
- `routeSnapshotStorage.ts`
- `rutasSupabaseService.ts`
- `types.ts`
- `package.json`
- `registro-jornada-deletion-regresion.cjs`
- `route-snapshot-regresion.cjs`

Añadidos por Registro/Facturación y kilometraje:

- `JornadaDetalle.tsx`
- `billing-regresion.cjs`
- `billingActivity.d.ts`
- `billingActivity.js`
- `billingSupabaseService.ts`
- `jornadaMetricas.d.mts`
- `jornadaMetricas.mjs`
- `kilometrajeSupabaseService.ts`
- `kilometraje-facturacion-regresion.cjs`
- `supabase/migrations/20261031150000_billing_daily_records.sql`
- `supabase/migrations/20261031170000_jornada_metricas.sql`
- `RELEVO_REGISTRO_FACTURACION.md`

También aparecen sin seguimiento:

- `diff-empresas-revision.txt`
- `revision-empresas.txt`

Conservarlos: no son parte del cambio de kilometraje.

No se descartó ningún cambio local.

## Migraciones

Proyecto de Supabase:

- Nombre: `logirute-ai`
- ID: `naepquyhfuubwsigtadb`

### Primera migración: aplicada

Archivo local:

`supabase/migrations/20261031150000_billing_daily_records.sql`

Aplicada mediante el conector de Supabase con el nombre `billing_daily_records`.

Supabase confirmó la ejecución correcta.

Incluye:

- Tabla independiente `billing_daily_records`.
- Unicidad por usuario y jornada.
- RLS de lectura propia.
- RPC autenticada `enviar_jornada_a_facturacion`.
- Conservación de la instantánea aunque se elimine el resumen de origen.

El usuario comprobó manualmente el botón de envío y la llegada del registro a Facturación.

No modificar ni volver a ejecutar esta migración. No alterar las instantáneas ya enviadas.

### Segunda migración: aplicada

Archivo local:

`supabase/migrations/20261031170000_jornada_metricas.sql`

Aplicada mediante el conector de Supabase con el nombre `jornada_metricas`, el 31-10-2026, aproximadamente a las 21:25, tras aprobación expresa.

Supabase confirmó la ejecución correcta.

La versión aplicada incluye:

- Tabla `kilometraje_jornadas` con estados `PENDIENTE` y `COMPLETA`.
- Trigger `registro_jornadas_exigir_kilometraje`.
- Función `marcar_kilometraje_jornada_nueva`.
- RPC `guardar_kilometraje_jornada_cerrada(text, text, text)`.
- Actualización de `enviar_jornada_a_facturacion` para bloquear capturas pendientes e incluir las lecturas definitivas en nuevas instantáneas.

Esta versión sustituyó la propuesta inicial basada en una tabla de kilometraje activo por usuario. No ejecutar versiones anteriores ni volver a aplicar esta migración.

No se cerraron jornadas ni se enviaron registros durante la ejecución de la migración. Las comprobaciones funcionales posteriores las realizó el usuario desde la aplicación local.

### Comprobación del servidor previa a la segunda migración

Una consulta de solo lectura confirmó:

- `billing_daily_records` existía.
- `kilometraje_jornadas` todavía no existía.
- `registro_jornadas` contenía 12 filas en el proyecto, cinco sin marcar como eliminadas.
- Los recuentos eran del proyecto completo, no de una cuenta concreta.
- Se revisaron las columnas de `registro_jornadas` y las definiciones de las funciones de cierre y envío existentes.

Antes de aplicar la segunda migración, la versión local mostraba:

`Could not find the table 'public.kilometraje_jornadas' in the schema cache`

El Registro pasaba a mostrar solo datos locales y parecía vacío.

Después de aplicar la migración, el usuario confirmó que el Registro volvió a la normalidad.

No se ha implementado una mejora para que un fallo de consulta complementaria de kilometraje permita seguir mostrando las jornadas remotas que sí puedan cargarse.

## Flujo del marcador de cierre

Según el fragmento real revisado de `RouteCloudPanel.tsx`, función `close`:

1. Se comprueba la asociación de las lecturas locales, salvo cuando ya existe un marcador pendiente.
2. Si existe un marcador pendiente que requiere lecturas y no las contiene, se validan y se incorporan al marcador.
3. En un cierre nuevo, se validan ambas lecturas y se solicita confirmación.
4. Se guarda la ruta mediante `saveSnapshot`.
5. Se construye el marcador con ID estable, huella, revisión y ambas lecturas.
6. Se escribe el marcador en `localStorage`.
7. Después se comprueba la sesión y se llama a `cerrar_jornada_remota`.
8. Se valida la respuesta del servidor.
9. Se intenta guardar el kilometraje definitivo con el mismo ID mediante `saveClosedJourneyKilometraje`.
10. Si ambas lecturas están presentes y el guardado termina, se llama a `onKilometrajeJornadaCerrada`.
11. Se comprueba si existen cambios locales posteriores que deban conservarse.
12. En el camino normal, se realiza una copia de seguridad y se aplica la ruta devuelta por el servidor mediante `applyRoute`.
13. Se retira el marcador al completar el flujo correspondiente.

La clave del marcador es:

`logiroute_cloud_close_v1:<userId>`

### Si falla la escritura previa del marcador

Las escrituras directas revisadas de `localStorage.setItem` para crear o completar el marcador están antes de la llamada a `cerrar_jornada_remota`.

Si una de esas escrituras lanza una excepción:

- Se interrumpe la acción.
- No se alcanza esa llamada a la RPC de cierre.
- El `catch` de `run()` captura el error y muestra el aviso.
- El `finally` libera el estado de operación.

No hace falta añadir el `try/catch` específico anteriormente propuesto para impedir ese cierre.

Puede haberse guardado previamente la ruta mediante `saveSnapshot`. Guardar la ruta no equivale a cerrar la jornada.

Esta conclusión procede de seguir el código mostrado. No equivale a una prueba real de fallo de almacenamiento.

Existe además una escritura posterior del marcador en el tratamiento de un cierre antiguo sin lecturas, cuando el servidor exige completar el kilometraje. No confundir esa escritura de recuperación con la persistencia previa al primer cierre.

## Históricas solo locales: aclaración del alcance

La revisión local no identificó un flujo independiente que suba resúmenes locales ya cerrados a `registro_jornadas`.

El flujo identificado de creación remota es el cierre de jornada.

La descarga y fusión mediante `listRemoteJornadas` y `mergeJornadaSnapshots` no constituye una subida.

Por tanto:

- No implementar por ahora una excepción para una importación histórica que no se ha identificado.
- Cerrar ahora una ruta antigua no justifica, por sí mismo, omitir el kilometraje obligatorio.
- No añadir una vía para saltarse `PENDIENTE` basada únicamente en un booleano y una fecha aportados por el cliente.
- No borrar manualmente filas `PENDIENTE` como solución general.
- Si aparece un flujo real de importación de resúmenes ya cerrados, revisarlo por separado antes de habilitarlo.

El trigger marca como `PENDIENTE` cualquier nueva inserción desde su instalación.

Las jornadas históricas ya existentes en el servidor siguen sin fila de estado.

## Kilometraje activo entre dispositivos

Las lecturas activas se guardan en `localStorage`, dentro de la instantánea local de ruta y separadas por usuario.

- Se recuperan en el mismo navegador y origen tras recarga o reapertura, mientras se conserve el almacenamiento.
- No se descargan ni sincronizan a otro dispositivo en esta versión.
- La copia del kilometraje llega al servidor al finalizar el cierre mediante el marcador.

No presentar esta funcionalidad como persistencia remota del kilometraje activo.

No ampliar la sincronización multidispositivo sin una decisión expresa.

## Pruebas ejecutadas y límites

### Comprobaciones locales comunicadas

Según los informes y las salidas de terminal aportadas, pasaron:

- `npm.cmd run typecheck`
- `npm.cmd run build`
- `npm.cmd run test:kilometraje-facturacion`
- `node route-snapshot-regresion.cjs`
- `node registro-jornada-deletion-regresion.cjs`
- `npm.cmd run test:aislamiento`
- `npm.cmd run test:registro`
- `git diff --check`

Se aportó salida de una ejecución de `typecheck`, `build`, `test:registro` y `test:kilometraje-facturacion`.

El build terminó con aviso de chunk JavaScript grande. Se comunicaron avisos de conversión LF/CRLF en comprobaciones de Git.

La salida del build también mostró:

`precache 428 entries (186002.51 KiB)`

No se investigó ese tamaño de precaché durante esta sesión. Revisarlo antes de publicar, sin asumir que el aviso de chunk es la única cuestión del build.

### Límites de los harness

Los harness de kilometraje/RPC y aislamiento utilizan simulaciones o inspección estática.

El contenido real revisado de `kilometraje-facturacion-regresion.cjs` incluye:

- Validación de lecturas y diferencia.
- Persistencia local de lecturas.
- Extracción estricta de pesos DeCA.
- Agregación de pesos y kilómetros con datos ausentes.
- Orden del detalle desde la instantánea.
- Inspección estática del SQL y de fragmentos de interfaz.
- Simulación de estados pendientes, finalización, bloqueo de Facturación e idempotencia.

No llama a Supabase ni valida la concurrencia, los permisos/RLS o el comportamiento real de las RPC.

No contiene una prueba del estado React posterior al cierre.

### Comprobaciones manuales del usuario

Después de aplicar ambas migraciones, el usuario confirmó:

- El Registro volvió a mostrar las jornadas.
- Una jornada nueva se cerró y apareció en nube.
- El resumen conservó lecturas `1000 → 1025 km` y `25 km recorridos`.
- Facturación recibió esos datos.
- El acumulado mensual marcó correctamente la ausencia de kilometraje en una jornada antigua.
- Se mostraron contadores de entregas y recogidas.
- Se mostraron pesos planificados y correspondientes a actividad realizada.
- El detalle desplegable de Facturación funciona.

Estas pruebas no cubren por sí solas todos los errores de red, la concurrencia, el aislamiento entre usuarios ni todos los caminos de recuperación.

## Incidencia pendiente: aviso después de cerrar

### Síntoma observado

Tras un cierre correcto:

- La ruta queda vacía.
- Los contadores de actividad están a cero.
- Los campos de kilometraje aparecen vacíos.
- Sigue apareciendo el aviso de asociación:

`Se cargó una ruta distinta de la que acompañaba estas lecturas. Revísalas antes de asociarlas.`

El resumen y la instantánea de Facturación sí conservaron correctamente los kilómetros de la jornada cerrada.

### Código real revisado

En `App.tsx`, `onKilometrajeJornadaCerrada` solicita:

- Vaciar `kilometrajeInicial`.
- Vaciar `kilometrajeFinal`.
- Poner `kilometrajeAsociacionPendiente` a `false`.
- Mostrar el mensaje de jornada cerrada.

En `RouteCloudPanel.close`, se llama a ese callback antes de aplicar la ruta devuelta por el cierre mediante `applyRoute`.

El `applyRoute` de `App.tsx` contiene:

- Comparación de IDs de paradas locales y remotas.
- Detección de sustitución de ruta cuando no comparten paradas.
- Detección de lecturas en el estado del render.
- Activación del aviso de asociación si interpreta que hay cambio de ruta con lecturas.

### Causa probable localizada

La secuencia de limpieza seguida de aplicación de la ruta vacía puede volver a activar el aviso usando las lecturas del render anterior.

La aplicación del resultado de un cierre confirmado se trata mediante la misma lógica que una carga de ruta distinta.

Esta explicación encaja con el síntoma y los fragmentos revisados. No se ha implementado ni validado una corrección.

### Criterio para corregir

Distinguir explícitamente:

- Cargar otra ruta, manteniendo la protección de asociación.
- Aplicar el resultado de un cierre confirmado, limpiando el kilometraje consumido por esa jornada.

La corrección debe:

- No ocultar simplemente todos los avisos cuando la ruta esté vacía.
- Conservar la protección ante cambios reales de ruta.
- No borrar marcadores pendientes.
- No perder cambios locales posteriores al cierre.
- Mantener coherentes el estado en memoria y la instantánea persistida.
- Incluir una prueba dirigida que reproduzca el estado posterior al cierre.

No limitarse a intercambiar callbacks sin revisar persistencia y caminos de error.

## Advertencia sobre las últimas respuestas de Cline

El agente utilizado para revisar este aviso presentó propuestas como si fueran cambios realizados y describió una salida de prueba que después reconoció que no era una ejecución real.

No usar esos informes como evidencia de edición o prueba.

Posteriormente se revisaron:

- El diff real de `App.tsx`.
- El fragmento real de cierre de `RouteCloudPanel.tsx`.
- El contenido completo de `kilometraje-facturacion-regresion.cjs`.

Resultado:

- El diff real de `App.tsx` no contiene la propiedad duplicada propuesta por Cline.
- No aparece aplicada aquella corrección contradictoria.
- El harness no contiene `fixtures.subject`, `s.applyRoute` ni la prueba inválida presentada por el agente.
- No hay una corrección fiable del aviso implementada en los fragmentos revisados.

No copiar los fragmentos propuestos por aquel agente.

No restaurar archivos para intentar deshacer una modificación que no se ha demostrado que exista.

## Mejoras solicitadas y todavía no implementadas

### Retirar jornadas de Facturación

El usuario ha solicitado poder borrar o retirar jornadas diarias de Facturación, especialmente las de prueba o enviadas por error.

Queda como mejora pendiente, no implementada.

Antes de desarrollarla, definir:

- Si será borrado definitivo o retirada conservando historial.
- La confirmación con identificación de la jornada.
- Qué ocurre con los acumulados mensuales.
- Si podrá enviarse de nuevo la misma jornada.
- Cómo conservar la trazabilidad.
- Los permisos y la operación de servidor correspondientes.

Debe ser independiente de eliminar el resumen en Registro y no borrar el origen automáticamente.

La inmutabilidad actual de las instantáneas no debe modificarse de forma improvisada.

### Fallo de consulta complementaria de kilometraje

Antes de aplicar la segunda migración, un fallo al consultar kilometraje provocó que el Registro pasara a mostrar solo datos locales.

Revisar como mejora si pueden seguir mostrándose las jornadas remotas cargadas cuando falle únicamente la información complementaria, con un aviso específico.

No implementado.

## Pendientes reales

1. Corregir el aviso de asociación posterior al cierre mediante un cambio mínimo y verificable.
2. Añadir y ejecutar una prueba dirigida del estado posterior al cierre.
3. Probar manualmente un fallo entre guardar el resumen y finalizar el kilometraje, cerrar y reabrir la aplicación y reintentar con el mismo ID y lecturas.
4. Validar en servidor que una jornada `PENDIENTE` no puede enviarse por primera vez a Facturación.
5. Validar los reintentos idénticos y el rechazo de lecturas distintas mediante pruebas reales controladas.
6. Completar las comprobaciones de permisos/RLS y aislamiento de las nuevas operaciones. No darlas por certificadas a partir de simulaciones.
7. Confirmar si la limitación de kilometraje activo solo local es aceptable para esta versión.
8. Revisar el tamaño de precaché mostrado por el build antes de publicar.
9. Actualizar el relevo tras cualquier cambio efectivo.
10. Revisar los archivos que se incluirían en un commit y obtener autorización antes de commit, push o despliegue.
11. Diseñar más adelante la retirada de jornadas de Facturación y la incorporación de tarifas.

No volver a listar la aplicación de la segunda migración como pendiente: ya se realizó.

## Pasos para continuar en una sesión nueva

1. Leer este documento y revisar `git status --short`.
2. Conservar todo el estado local: no restaurar, limpiar ni descartar archivos.
3. Revisar únicamente los archivos necesarios, especialmente:
   - `App.tsx`
   - `RouteCloudPanel.tsx`
   - `routeSnapshotStorage.ts`
   - `kilometrajeSupabaseService.ts`
   - `kilometraje-facturacion-regresion.cjs`
4. Partir del código real guardado, no de las propuestas contradictorias de Cline.
5. Resolver el aviso posterior al cierre distinguiendo cierre confirmado de sustitución de ruta.
6. Revisar el diff efectivo y ejecutar una prueba válida del caso corregido.
7. Ejecutar los harness pertinentes, `typecheck` y `build` si se modifica código.
8. Distinguir siempre comprobaciones estáticas, simulaciones y pruebas reales.
9. No reabrir como defecto la falta de un `try/catch` específico alrededor de la escritura previa del marcador: el flujo revisado ya interrumpe la RPC si esa escritura lanza.
10. No diseñar una excepción histórica sin identificar primero un flujo real que la necesite.
11. No modificar ni volver a ejecutar las dos migraciones aplicadas.
12. No alterar las instantáneas ya enviadas.
13. Si hace falta SQL adicional, preparar una nueva migración y solicitar aprobación expresa.
14. Antes de publicar, revisar el estado de los archivos, las pruebas pendientes y la precaché de la PWA.

## Límites de autorización

Las autorizaciones concedidas durante esta sesión permitieron las consultas y las dos migraciones concretas ya ejecutadas.

No constituyen autorización general para nuevas operaciones remotas.

No ejecutar nuevo SQL remoto, migraciones adicionales, commit, push ni despliegue sin autorización expresa posterior.

No instalar dependencias, ampliar funcionalidades ni modificar archivos ajenos a la tarea sin necesidad y aprobación.

El trabajo local permanece sin publicar. Preservar tanto los archivos modificados como los nuevos sin seguimiento.
