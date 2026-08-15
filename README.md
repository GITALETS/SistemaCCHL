# Sistema de Generación de Constancias CCHL / DC-3

> **Comisión Federal de Electricidad (CFE) — Capacitación y Adiestramiento**  
> Aplicación web cliente para el procesamiento automatizado de créditos de capacitación, gestión de Kardex e inserción dinámica de datos en plantillas oficiales de Microsoft Word (`.docx`).

---

## Tabla de Contenidos
- [Características Principales](#características-principales)
- [Arquitectura y Privacidad (100% Client-Side)](#arquitectura-y-privacidad-100-client-side)
- [Catálogo de Variables / Marcas de Correspondencia](#catálogo-de-variables--marcas-de-correspondencia)
- [Requisitos y Compatibilidad](#requisitos-y-compatibilidad)
- [Guía de Uso](#guía-de-uso)
  - [1. Cargar Bases de Datos y Plantilla](#1-cargar-bases-de-datos-y-plantilla)
  - [2. Configuración y Catálogos](#2-configuración-y-catálogos)
  - [3. Generación y Descarga](#3-generación-y-descarga)
- [Estructura del Proyecto](#estructura-del-proyecto)
- [Stack Tecnológico](#stack-tecnológico)

---

## Características Principales

- **Procesamiento de Créditos Excel (`.xlsx`)**: Lectura automatizada de pestañas `CAPPA` (Créditos Aprobados) y `CAPPI` (Créditos Iniciales/Individuales), extrayendo RPE, Nombre Completo, CURP, Puesto, Nombre de la Batería, Curso y Horas.
- **Compatibilidad con Plantillas Word (`.docx`)**: Mantenimiento estricto de formatos, tablas, fuentes, encabezados y logotipos oficiales utilizando la plantilla `CCHL MODIFICABLE.docx`.
- **Gestión Integrada de Kardex**: Importación de archivos individuales de Kardex para autocompletar fechas históricas de inicio y término por curso.
- **Gestión de Representantes e Instructores**: Asignación dinámica de nombres oficiales para representantes del patrón, representantes de trabajadores e instructores por periodos lectivos.
- **Exportación Flexible**:
  - **Documento Único Consolidado**: Archivo `.docx` unificado con saltos de página para impresión masiva.
  - **Paquete Comprimido ZIP**: Paquete `.zip` con archivos Word individuales estructurados por trabajador y curso.
- **Validaciones Automatizadas**:
  - Verificación de longitud oficial de CURP (18 caracteres).
  - Inserción automática de leyenda de regularización para cursos aprobados en o antes del año 2021.
  - Generación de rangos aleatorios de fechas ajustables dentro del periodo lectivo si no existe registro en Kardex.

---

## Arquitectura y Privacidad (100% Client-Side)

El sistema ha sido diseñado bajo una arquitectura **totalmente ejecutada en el navegador web del cliente**:

- **Sin Servidor Backend / Sin Almacenamiento Remoto**: La lectura de archivos Excel, el cruce de datos y la compilación de los documentos Word se procesan de forma 100% local en la memoria de tu equipo. Ningún dato personal o de la empresa se transmite a servidores externos.
- **Persistencia Local Segura**: Los catálogos e historiales cargados se almacenan de manera persistente y privada en la base de datos local del navegador (**IndexedDB** y **LocalStorage**).

---

## Catálogo de Variables / Marcas de Correspondencia

Para sustituir la información automáticamente en la plantilla `CCHL MODIFICABLE.docx`, utiliza las siguientes marcas de correspondencia en el documento Word:

| Variable en Plantilla Word | Descripción / Campo Asociado | Ejemplo |
| :--- | :--- | :--- |
| `«NOMBRE»` | Nombre completo del trabajador | `JUAN PEREZ LOPEZ` |
| `«CURP»` | Clave Única de Registro de Población | `PELJ900101HDFRRN09` |
| `«PUESTO»` / `«NUMERO_PUESTO»` | Número / Denominación de Puesto | `PUESTO 12345` |
| `«BATERIA»` / `«NOMBRE_BATERIA»` | Nombre de la Batería de Capacitación | `MANTENIMIENTO ELECTRICO` |
| `«CURSO»` / `«NOMBRE_CURSO»` | Nombre oficial del curso impartido | `SEGURIDAD EN TRABAJOS EN ALTURA` |
| `«HORAS»` | Duración del curso en horas | `40` |
| `«FECHA_INICIO»` | Fecha de inicio del curso | `15 DE ENERO DE 2023` |
| `«FECHA_FIN»` | Fecha de término del curso | `20 DE ENERO DE 2023` |
| `«INSTRUCTOR»` | Nombre del instructor registrado | `ING. CARLOS GUTIERREZ` |
| `«PATRON_REP»` | Representante del Patrón | `LIC. JOSE DAVID LOPEZ MEDINA` |
| `«TRABAJADOR_REP»` | Representante de los Trabajadores | `JUAN CARLOS SERNA GOMEZ` |

---

## Requisitos y Compatibilidad

### Navegadores Compatibles
- Google Chrome (Recomendado)
- Microsoft Edge
- Mozilla Firefox
- Opera / Brave / Safari

### Requisitos de Ejecución
- No requiere Node.js, Python ni servidores backend instalados.
- Se ejecuta directamente abriendo `index.html` en el navegador o mediante un servidor de archivos estáticos (ej. Live Server, Nginx, GitHub Pages).

---

## Guía de Uso

### 1. Cargar Bases de Datos y Plantilla
1. Abre `index.html` en tu navegador.
2. En la pestaña **1. Cargar Archivos**:
   - Sube el archivo Excel de Créditos (`.xlsx`).
   - Sube la plantilla base Word (`CCHL MODIFICABLE.docx`).
   - *(Opcional)* Sube archivos Excel individuales de Kardex.

### 2. Configuración y Catálogos
1. Navega a la pestaña **3. Configuración y Catálogos**.
2. Configura los representantes de la empresa (Patrón y Trabajadores) y el catálogo de instructores.

### 3. Generación y Descarga
1. Navega a la pestaña **2. Generador CCHL**.
2. Selecciona un trabajador del menú lateral.
3. Revisa y ajusta los cursos seleccionados y las fechas correspondientes.
4. Genera los archivos mediante:
   - **Descargar Documento Único**: Archivo `.docx` consolidado.
   - **Descargar Paquete ZIP**: Archivo `.zip` con documentos separados.

---

## Estructura del Proyecto

```text
Generador_DC3_Sistema/
├── index.html                 # Interfaz de usuario principal (HTML5)
├── css/
│   └── styles.css            # Estilos generales, variables y diseño moderno
├── js/
│   └── app.js                # Lógica de parsing Excel, reemplazo Word en cliente e IndexedDB
├── CCHL MODIFICABLE.docx      # Plantilla base oficial de constancias Word
├── .gitignore                 # Reglas de exclusión de Git para privacidad de datos
└── README.md                  # Documentación oficial del sistema
```

---

## Stack Tecnológico

- **HTML5 & Vanilla CSS3**: Diseño responsive con componentes accesibles e iconografía SVG nativa.
- **JavaScript (ES6+)**: Procesamiento asíncrono y manipulación de datos en cliente.
- **SheetJS (xlsx.full.min.js)**: Parsing y extracción de datos de hojas de cálculo Excel.
- **Docxtemplater & PizZip**: Motor de templating nativo para documentos `.docx`.
- **JSZip & FileSaver**: Compresión ZIP y descarga directa de archivos en el navegador.
- **IndexedDB & LocalStorage**: Persistencia local segura de datos y configuraciones.
