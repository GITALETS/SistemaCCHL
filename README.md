# Sistema de Generación de Constancias CCHL / DC-3

Aplicación web cliente para el procesamiento de créditos de capacitación, gestión de kardex y generación masiva de constancias de competencias laborales CCHL / DC-3 en formato Microsoft Word (.docx).

## Descripción General

El sistema permite procesar bases de datos de créditos de capacitación (hojas CAPPA y CAPPI) de la Comisión Federal de Electricidad (CFE), cruzar la información con historiales de Kardex de calificaciones y generar constancias en formato oficial Word preservando el diseño, encabezados, tablas y formatos originales.

---

## Características Principales

1. **Carga y Procesamiento de Créditos (.xlsx)**:
   - Lectura automatizada de hojas `CAPPA` y `CAPPI`.
   - Extracción de RPE, Nombre Completo, CURP, Puesto, Nombre de la Batería, Nombre del Curso y Horas.
   - Botón de descarga para plantilla de ejemplo Excel con la estructura requerida.

2. **Compatibilidad con Plantillas Word (.docx)**:
   - Utiliza la plantilla oficial `CCHL MODIFICABLE.docx`.
   - Reemplazo de variables dinámicas mediante marcas de correspondencia `«NOMBRE»`, `«CURSO»`, `«INSTRUCTOR»`, `«CURP»`, entre otras.
   - Preservación completa de logos, fuentes, tablas y alineaciones originales.

3. **Gestión de Kardex e Historial de Calificaciones**:
   - Carga masiva de archivos Excel individuales de Kardex.
   - Asignación de fechas de inicio y término por curso.

4. **Validaciones Automatizadas**:
   - Verificación de longitud de CURP (18 caracteres).
   - Verificación de estructura numérica para Número de Puesto.
   - Inserción automática de la leyenda de regularización para cursos con fecha de término menor o igual al año 2021.

5. **Exportación Flexibles**:
   - Generación de un único documento consolidado con salto de página para impresión masiva.
   - Generación de paquete comprimido ZIP con archivos individuales por curso y trabajador.

6. **Integración Externa**:
   - Botón de enlace directo en cabecera al sistema CO-03: `https://SistemaCO.onrender.com`.

---

## Estructura del Proyecto

- `index.html`: Interfaz principal de usuario con navegación por paneles.
- `css/styles.css`: Sistema de estilos con tema moderno y adaptativo.
- `js/app.js`: Lógica de procesamiento de archivos Excel, reemplazo Word en navegador y control de la aplicación.
- `CCHL MODIFICABLE.docx`: Plantilla base para la generación de constancias.

---

## Requisitos de Ejecución

La aplicación se ejecuta de manera local en el navegador web (100% en el cliente, sin necesidad de servidor backend).

### Navegadores Soportados:
- Google Chrome
- Microsoft Edge
- Mozilla Firefox
- Opera / Brave

---

## Modo de Uso

1. **Cargar Bases de Datos**:
   - Navegar al panel "1. Cargar Archivos".
   - Subir el archivo `CREDITOS.xlsx` (con las pestañas `CAPPA` y `CAPPI`).
   - Subir la plantilla `CCHL MODIFICABLE.docx`.
   - Subir archivos masivos de Kardex (.xlsx).

2. **Seleccionar y Configurar**:
   - Navegar al panel "2. Generador CCHL".
   - Seleccionar un trabajador de la lista lateral.
   - Verificar y/o ajustar el Número de Puesto y los representantes.
   - Seleccionar los cursos a incluir en la constancia.

3. **Descargar Constancias**:
   - Hacer clic en "Descargar Documento Único" para un archivo consolidado.
   - Hacer clic en "Descargar Paquete ZIP" para archivos separados.
