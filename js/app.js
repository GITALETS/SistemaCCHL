// Solución robusta nativa para descargas sin depender de FileSaver externo
const saveAs = (blob, fileName) => {
    try {
        if (typeof window.navigator.msSaveOrOpenBlob !== 'undefined') {
            window.navigator.msSaveOrOpenBlob(blob, fileName);
            return;
        }
    } catch (e) { }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.target = "_blank"; // Abre en pestaña nueva si es interceptado para evitar redirección de la app
    document.body.appendChild(a);
    a.click();

    // Deferir remoción para dar tiempo al navegador de iniciar la descarga
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 600);
};

// --- PERSISTENCIA CON INDEXEDDB ---
const DB_NAME = 'CFE_DC3_DB';
const DB_VERSION = 1;

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('assets')) {
                db.createObjectStore('assets', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('kardex_files')) {
                db.createObjectStore('kardex_files', { keyPath: 'workerName' });
            }
        };
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

async function saveAsset(id, name, data) {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('assets', 'readwrite');
            const store = tx.objectStore('assets');
            const request = store.put({ id, name, data });
            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e.target.error);
        });
    } catch (e) {
        console.error('Error saving asset to IndexedDB:', e);
    }
}

async function getAsset(id) {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('assets', 'readonly');
            const store = tx.objectStore('assets');
            const request = store.get(id);
            request.onsuccess = (e) => resolve(e.target.result);
            request.onerror = (e) => reject(e.target.error);
        });
    } catch (e) {
        console.error('Error getting asset from IndexedDB:', e);
        return null;
    }
}

async function saveKardexFile(workerName, fileName, rows) {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('kardex_files', 'readwrite');
            const store = tx.objectStore('kardex_files');
            const request = store.put({ workerName, name: fileName, rows });
            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e.target.error);
        });
    } catch (e) {
        console.error('Error saving Kardex to IndexedDB:', e);
    }
}

async function getAllKardexFiles() {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('kardex_files', 'readonly');
            const store = tx.objectStore('kardex_files');
            const request = store.getAll();
            request.onsuccess = (e) => resolve(e.target.result || []);
            request.onerror = (e) => reject(e.target.error);
        });
    } catch (e) {
        console.error('Error getting all Kardex files from IndexedDB:', e);
        return [];
    }
}

async function clearAllIndexedDB() {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(['assets', 'kardex_files'], 'readwrite');
            tx.objectStore('assets').clear();
            tx.objectStore('kardex_files').clear();
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });
    } catch (e) {
        console.error('Error clearing IndexedDB:', e);
    }
}

async function resetDatabaseAction() {
    if (confirm("¿Estás seguro de que deseas eliminar TODOS los archivos guardados (Créditos, Plantilla Word y Kardex de trabajadores) de la memoria local? Esto restablecerá la aplicación a su estado inicial.")) {
        playSound('click');
        // Clear IndexedDB
        await clearAllIndexedDB();

        // Clear active selected worker and manual courses and customized course dates
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('cfe_')) {
                // Keep configurations like profiles, rand-min-year, rand-max-year, instructors catalog
                if (!key.startsWith('cfe_rep_profiles') &&
                    !key.startsWith('cfe_rand_') &&
                    !key.startsWith('cfe_instructors_') &&
                    !key.startsWith('cfe_date_history')) {
                    keysToRemove.push(key);
                }
            }
        }
        keysToRemove.forEach(k => localStorage.removeItem(k));

        // Reset AppState
        AppState.workers = [];
        AppState.templateFile = null;
        AppState.historyFiles = {};
        AppState.selectedWorker = null;
        AppState.workerCoursesList = [];
        rawCreditsWorkers = [];

        // Reset Upload Zones UI
        resetUploadZone('zone-courses', 'Arrastra el archivo de Créditos (CAPPA/CAPPI) o haz clic para buscar');
        resetUploadZone('zone-template', 'Arrastra la plantilla CCHL MODIFICABLE.docx');

        // Clear detected tags
        const container = document.getElementById('detected-tags-container');
        const label = document.getElementById('detected-tags-label');
        if (container) container.innerHTML = '';
        if (label) label.style.display = 'none';

        // Reset Kardex UI
        statusTextHistory.textContent = '0 archivos de Kardex cargados';
        statusDotHistory.classList.remove('active');
        zoneHistory.classList.remove('success');
        const fnEl = zoneHistory.querySelector('.file-name');
        if (fnEl) zoneHistory.removeChild(fnEl);
        const descEl = zoneHistory.querySelector('.desc');
        if (descEl) descEl.style.display = 'block';

        // Disable generate tab and manual course button
        checkInitState();
        const manualBtn = document.getElementById('btn-add-manual-course');
        if (manualBtn) manualBtn.disabled = true;

        // Hide manual course form
        const manualForm = document.getElementById('manual-course-form-container');
        if (manualForm) manualForm.style.display = 'none';

        switchTab('tab-load');

        // Refresh worker list
        renderWorkerList();

        showNotification("Memoria local y base de datos reseteadas con éxito.");
    }
}

async function restoreSavedState() {
    try {
        // 1. Restore template file
        const templateAsset = await getAsset('template_file');
        if (templateAsset) {
            processTemplateFile(templateAsset.data, templateAsset.name);
        }

        // 2. Restore history files (Kardex)
        const kardexes = await getAllKardexFiles();
        if (kardexes && kardexes.length > 0) {
            kardexes.forEach(k => {
                AppState.historyFiles[k.workerName] = k.rows;
            });
            statusTextHistory.textContent = `${Object.keys(AppState.historyFiles).length} trabajadores con Kardex cargados`;
            statusDotHistory.classList.add('active');
            zoneHistory.classList.add('success');
        }

        // 3. Restore credits file (do this last so worker selection can match the loaded credits list)
        const creditsAsset = await getAsset('credits_file');
        if (creditsAsset) {
            processCreditsFile(creditsAsset.data, creditsAsset.name);
        }

        // 4. Update tab button ready state
        checkInitState();
    } catch (e) {
        console.error("Error restoring saved state from IndexedDB:", e);
    }
}

// Reordenar nombre a "APELLIDOS NOMBRE" (ej. "BALDOMERO CORTEZ LARA" -> "CORTEZ LARA BALDOMERO")
function formatSurnamesFirst(fullName) {
    if (!fullName) return '';
    const parts = fullName.trim().split(/\s+/);
    if (parts.length <= 1) {
        return fullName.toUpperCase();
    }
    if (parts.length === 2) {
        return `${parts[1]} ${parts[0]}`.toUpperCase();
    }
    const surnames = parts.slice(-2).join(' ');
    const names = parts.slice(0, -2).join(' ');
    return `${surnames} ${names}`.toUpperCase();
}

function base64ToBinaryBuffer(base64Data) {
    if (!base64Data) return "";
    try {
        const cleanBase64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
        return atob(cleanBase64);
    } catch (e) {
        console.error("Error al convertir base64 a binario:", e);
        return "";
    }
}

function createDocxtemplaterInstance(zipContent) {
    return new window.docxtemplater(zipContent, {
        paragraphLoop: true,
        linebreaks: true,
        delimiters: {
            start: "«",
            end: "»"
        }
    });
}

// Preprocesar plantilla Word para convertir MergeFields nativos a tags simples «NOMBRE»
function preprocessTemplateXml(templateFileBuffer) {
    const zipContent = new PizZip(templateFileBuffer);
    let docXml = zipContent.files["word/document.xml"].asText();

    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(docXml, "text/xml");

    // 1. Procesar campos de combinación simples <w:fldSimple>
    const simpleFields = Array.from(xmlDoc.getElementsByTagName("w:fldSimple"));
    simpleFields.forEach(field => {
        const instr = field.getAttribute("w:instr") || "";
        const match = instr.match(/MERGEFIELD\s+([^\s]+)/i);
        if (match) {
            const varName = match[1].replace(/[«»]/g, "").trim();

            const run = xmlDoc.createElement("w:r");
            const text = xmlDoc.createElement("w:t");
            text.textContent = `«${varName}»`;
            run.appendChild(text);

            field.parentNode.replaceChild(run, field);
        }
    });

    // 2. Procesar campos de combinación complejos fldChar begin ... instrText ... separate ... end
    const fldChars = xmlDoc.getElementsByTagName("w:fldChar");
    const begins = [];
    for (let i = 0; i < fldChars.length; i++) {
        if (fldChars[i].getAttribute("w:fldCharType") === "begin") {
            begins.push(fldChars[i]);
        }
    }

    begins.forEach(begin => {
        let runBegin = begin.parentNode;
        while (runBegin && runBegin.tagName !== "w:r") {
            runBegin = runBegin.parentNode;
        }
        if (!runBegin) return;

        let siblings = [];
        let curr = runBegin.nextSibling;
        let instrTextNode = null;
        let runEnd = null;

        while (curr) {
            siblings.push(curr);
            if (curr.nodeType === 1) { // Element Node
                if (curr.tagName === "w:r") {
                    const instrText = curr.getElementsByTagName("w:instrText")[0];
                    if (instrText) instrTextNode = instrText;

                    const fldChar = curr.getElementsByTagName("w:fldChar")[0];
                    if (fldChar && fldChar.getAttribute("w:fldCharType") === "end") {
                        runEnd = curr;
                        break;
                    }
                }
            }
            curr = curr.nextSibling;
        }

        if (instrTextNode && runEnd) {
            const instr = instrTextNode.textContent || "";
            const match = instr.match(/MERGEFIELD\s+([^\s]+)/i);
            if (match) {
                const varName = match[1].replace(/[«»]/g, "").trim();

                const newRun = xmlDoc.createElement("w:r");
                const newText = xmlDoc.createElement("w:t");
                newText.textContent = `«${varName}»`;
                newRun.appendChild(newText);

                const parent = runBegin.parentNode;
                parent.insertBefore(newRun, runBegin);

                if (runBegin.parentNode === parent) parent.removeChild(runBegin);
                siblings.forEach(sib => {
                    if (sib.parentNode === parent) {
                        parent.removeChild(sib);
                    }
                });
            }
        }
    });

    const serializer = new XMLSerializer();
    let newXmlText = serializer.serializeToString(xmlDoc);

    // Inject regularisation legend if year <= 2021 (optimized with a balanced 7.5pt font and compact spacing to prevent blank page overflow)
    const legendXml = '<w:p><w:r><w:t>«#hasLegend»</w:t></w:r></w:p><w:p><w:pPr><w:jc w:val="both"/><w:spacing w:before="30" w:after="10" w:line="170" w:lineRule="exact"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="15"/><w:szCs w:val="15"/><w:italic/></w:rPr><w:t>Dando seguimiento a la supervisión nacional se identificó que hay CCHL en años anteriores al 2024 que no están impresas por lo que se estarán regularizando con el nombre de la autoridades actuales para contar con el expediente completo atentamente Lic. Ivonne Reza Rugerio jefa de oficina de capacitación en funciones</w:t></w:r></w:p><w:p><w:r><w:t>«/hasLegend»</w:t></w:r></w:p>';

    const sectPrIdx = newXmlText.lastIndexOf("<w:sectPr");
    if (sectPrIdx !== -1) {
        newXmlText = newXmlText.substring(0, sectPrIdx) + legendXml + newXmlText.substring(sectPrIdx);
    } else {
        const bodyEndIdx = newXmlText.lastIndexOf("</w:body>");
        if (bodyEndIdx !== -1) {
            newXmlText = newXmlText.substring(0, bodyEndIdx) + legendXml + newXmlText.substring(bodyEndIdx);
        }
    }

    zipContent.file("word/document.xml", newXmlText);
    return zipContent;
}

// Web Audio Synthesizer for offline sound effects (Disabled per user request)
function playSound(type) {}

// Instructores por defecto (23 nombres)
const DEFAULT_INSTRUCTORS = [
    "FRANCISCO JAVIER MARTÍNEZ RUIZ",
    "BALDOMERO CORTEZ LARA",
    "DAVID VICENTE ESPINOZA SOTO",
    "BENJAMÍN ORTEGA SUÁREZ",
    "EDGAR NOE GRACIA LÓPEZ",
    "ERNESTO LENIN BARRIGA ARREOLA",
    "ISMAEL GARCÍA VALDEZ",
    "MANUEL FLORES OVANDO",
    "SANTIAGO AYALA ESTRADA",
    "SERGIO OVANDO GARCÍA",
    "URIEL UNDA SÁNCHEZ",
    "WALTER SALVADOR AGUILAR GUZMÁN",
    "ZEUS ADONIS GALICIA LUNA",
    "DANIEL ALFARO SÁMANO",
    "MARTÍN ALEJANDRO MORENO GUERRERO",
    "MIGUEL ÁNGEL RAMÍREZ REYES",
    "MARCOS ALMERAYA VELASCO",
    "ERNESTO GARDUÑO RAMÍREZ",
    "ISRAEL GARCÍA SERVÍN",
    "IVÁN ARMANDO SÁNCHEZ LORÍA",
    "EZEQUIEL DANIEL VELÁZQUEZ CORTÉS",
    "JORGE ENRIQUE GÓMEZ CABRERA",
    "RAMÓN OCHOA VERDUZCO"
];

// Global State
const AppState = {
    workers: [],       // Combined workers list
    courses: [],       // General courses catalog
    instructors: [],   // Instructors list
    templateFile: null,// ArrayBuffer of word template
    historyFiles: {},  // Map of workerName -> Course history rows
    selectedWorker: null,
    workerCoursesList: [], // Required courses for currently selected worker
    activeLetters: new Set(),
    letterFilterEnabled: false,
    profiles: [],      // Signature profiles
    activeProfileId: null, // Active profile ID
    digitalSignatures: []  // Registered digital signature images
};

// --- MOTOR DE FIRMAS DIGITALES ---
// --- CONSTANTES BASE64 PARA FIRMAS PREDETERMINADAS ---
const DEFAULT_SIG_DAVID = "data:image/png;base64,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";
const DEFAULT_SIG_SERNA = "data:image/png;base64,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";

function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

async function extractSignaturesFromExcelBuffer(fileBuffer, fileName = 'Excel') {
    try {
        const zip = new PizZip(fileBuffer);
        const mediaFiles = [];
        
        Object.keys(zip.files).forEach(filename => {
            if (filename.startsWith("xl/media/") && !zip.files[filename].dir) {
                const ext = filename.split('.').pop().toLowerCase();
                if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'].includes(ext)) {
                    const mime = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' : ('image/' + ext);
                    const binary = zip.files[filename].asArrayBuffer();
                    const b64 = arrayBufferToBase64(binary);
                    const dataUrl = 'data:' + mime + ';base64,' + b64;
                    mediaFiles.push({ filename: filename, dataUrl: dataUrl });
                }
            }
        });

        const workbook = XLSX.read(new Uint8Array(fileBuffer), { type: 'array' });
        const firmaSheetName = workbook.SheetNames.find(s => s.toUpperCase().includes('FIRMA'));
        
        let loadedCount = 0;
        if (firmaSheetName) {
            const worksheet = workbook.Sheets[firmaSheetName];
            const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
            if (rows && rows.length > 0) {
                let headerRowIdx = rows.findIndex(r => r && r.some(c => {
                    const str = String(c||'').toUpperCase();
                    return str.includes('NOMBRE') || str.includes('PERSONA') || str.includes('REPRESENTANTE') || str.includes('INSTRUCTOR');
                }));
                if (headerRowIdx === -1) headerRowIdx = 0;
                
                const headerRow = rows[headerRowIdx] || [];
                let nameCol = headerRow.findIndex(h => {
                    const str = String(h||'').toUpperCase();
                    return str.includes('NOMBRE') || str.includes('PERSONA') || str.includes('TRABAJADOR') || str.includes('REPRESENTANTE');
                });
                if (nameCol === -1) nameCol = 0;
                
                let typeCol = headerRow.findIndex(h => {
                    const str = String(h||'').toUpperCase();
                    return str.includes('TIPO') || str.includes('ROL') || str.includes('CARGO') || str.includes('PUESTO');
                });
                
                let yearCol = headerRow.findIndex(h => {
                    const str = String(h||'').toUpperCase();
                    return str.includes('AÑO') || str.includes('ANO') || str.includes('INICIO');
                });

                let mediaIdx = 0;
                for (let i = headerRowIdx + 1; i < rows.length; i++) {
                    const row = rows[i];
                    if (!row || !row[nameCol]) continue;
                    const personName = String(row[nameCol]).trim();
                    if (!personName) continue;

                    const roleType = typeCol >= 0 ? String(row[typeCol] || '').toUpperCase() : '';
                    const startYear = yearCol >= 0 ? parseInt(row[yearCol]) : null;

                    let dataUrl = null;
                    if (mediaFiles[mediaIdx]) {
                        dataUrl = mediaFiles[mediaIdx].dataUrl;
                        mediaIdx++;
                    }

                    if (dataUrl) {
                        registerDigitalSignatureFromExcel(personName, dataUrl, roleType, startYear);
                        loadedCount++;
                    }
                }
            }
        } else if (mediaFiles.length > 0) {
            mediaFiles.forEach((m, idx) => {
                const basename = m.filename.split('/').pop();
                const cleanKey = cleanNameForMatching(basename);
                if (cleanKey) {
                    registerDigitalSignatureFromExcel('Firma Excel ' + (idx + 1), m.dataUrl);
                    loadedCount++;
                }
            });
        }

        if (loadedCount > 0) {
            saveDigitalSignatures();
            showNotification('Se importaron ' + loadedCount + ' firma(s) digital(es) desde ' + fileName + '.');
        }
        return loadedCount;
    } catch (e) {
        console.error("Error al extraer firmas de Excel:", e);
        return 0;
    }
}

function registerDigitalSignatureFromExcel(personName, dataUrl, roleType = '', startYear = null) {
    const cleanKey = cleanNameForMatching(personName);
    if (!cleanKey || !dataUrl) return;

    const existingIdx = AppState.digitalSignatures.findIndex(s => s.parsedKey === cleanKey);
    const sigObj = {
        id: 'excel_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
        originalName: personName,
        parsedKey: cleanKey,
        dataUrl: dataUrl
    };

    if (existingIdx !== -1) {
        AppState.digitalSignatures[existingIdx] = sigObj;
    } else {
        AppState.digitalSignatures.push(sigObj);
    }

    if (roleType.includes('PATRON') || roleType.includes('PATRÓN')) {
        const patronInput = document.getElementById('config-patron-rep');
        if (patronInput) patronInput.value = personName.toUpperCase();
        localStorage.setItem('cfe_patron_rep', personName.toUpperCase());
        if (startYear && !isNaN(startYear)) {
            const yrInput = document.getElementById('config-patron-year');
            if (yrInput) yrInput.value = startYear;
            localStorage.setItem('cfe_patron_year', startYear);
        }
    } else if (roleType.includes('WORKER') || roleType.includes('TRABAJADOR') || roleType.includes('SINDICATO')) {
        const workerInput = document.getElementById('config-worker-rep');
        if (workerInput) workerInput.value = personName.toUpperCase();
        localStorage.setItem('cfe_worker_rep', personName.toUpperCase());
        if (startYear && !isNaN(startYear)) {
            const yrInput = document.getElementById('config-worker-year');
            if (yrInput) yrInput.value = startYear;
            localStorage.setItem('cfe_worker_year', startYear);
        }
    }
}

async function handleExcelSignatureUpload(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];
    try {
        const buffer = await file.arrayBuffer();
        const count = await extractSignaturesFromExcelBuffer(buffer, file.name);
        if (count === 0) {
            showNotification('No se encontraron imágenes o la hoja FIRMAS en ' + file.name + '.', true);
        }
    } catch (e) {
        showNotification('Error al leer el archivo Excel de firmas: ' + e.message, true);
    }
    event.target.value = '';
}

function cleanNameForMatching(str) {
    if (!str) return '';
    let clean = String(str).toLowerCase().trim();
    // Normalizar NFD para eliminar acentos / diacríticos
    clean = clean.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    // Eliminar extensión de archivo si aplica
    clean = clean.replace(/\.(png|jpg|jpeg|webp|svg)$/i, "");
    // Eliminar prefijos / sufijos comunes como "firma", "firmas", "lic", "ing", "dr", "dra"
    clean = clean.replace(/\b(firma|firmas|lic|licenciado|ing|ingeniero|dr|doctor|dra|doctora)\b/g, "");
    // Reemplazar caracteres no alfanuméricos por espacio
    clean = clean.replace(/[^a-z0-9\s]/g, " ");
    // Colapsar espacios múltiples
    clean = clean.replace(/\s+/g, " ").trim();
    return clean;
}

function findSignatureForName(personName) {
    if (!personName || !AppState.digitalSignatures || AppState.digitalSignatures.length === 0) return null;
    const cleanTarget = cleanNameForMatching(personName);
    if (!cleanTarget) return null;

    // 1. Coincidencia exacta de clave limpia
    let match = AppState.digitalSignatures.find(s => s.parsedKey === cleanTarget);
    if (match) return match.dataUrl;

    // 2. Coincidencia por subcadena (ej. "juan carlos serna" dentro de "juan carlos serna gomez")
    match = AppState.digitalSignatures.find(s => {
        if (!s.parsedKey) return false;
        return cleanTarget.includes(s.parsedKey) || s.parsedKey.includes(cleanTarget);
    });

    return match ? match.dataUrl : null;
}

function loadDigitalSignatures() {
    const stored = localStorage.getItem('cfe_digital_signatures');
    if (stored) {
        try {
            AppState.digitalSignatures = JSON.parse(stored);
        } catch (e) {
            AppState.digitalSignatures = [];
        }
    } else {
        AppState.digitalSignatures = [];
    }

    // Auto-detectar firmas predeterminadas si están en la raíz
    autoDetectDefaultSignatures();
    renderDigitalSignaturesList();
}

function saveDigitalSignatures() {
    try {
        localStorage.setItem('cfe_digital_signatures', JSON.stringify(AppState.digitalSignatures));
    } catch (e) {
        console.error("Error al guardar firmas digitales:", e);
    }
    renderDigitalSignaturesList();
}

function autoDetectDefaultSignatures() {
    const defaults = [
        { name: "JOSE DAVID LOPEZ MEDINA", key: "jose david lopez", b64: DEFAULT_SIG_DAVID, original: "firma jose david lopez.png" },
        { name: "JUAN CARLOS SERNA GOMEZ", key: "juan carlos serna", b64: DEFAULT_SIG_SERNA, original: "firma juan carlos serna.png" }
    ];

    defaults.forEach(def => {
        const existingIdx = AppState.digitalSignatures.findIndex(s => s.parsedKey === def.key || (s.originalName && s.originalName.toLowerCase().includes(def.key)));
        if (existingIdx === -1) {
            AppState.digitalSignatures.push({
                id: 'def_' + def.key.replace(/\s+/g, '_'),
                originalName: def.original,
                parsedKey: def.key,
                dataUrl: def.b64
            });
        } else if (!AppState.digitalSignatures[existingIdx].dataUrl || AppState.digitalSignatures[existingIdx].dataUrl.length < 100) {
            AppState.digitalSignatures[existingIdx].dataUrl = def.b64;
        }
    });

    saveDigitalSignatures();
}

function toggleDigitalSignaturesPanel() {
    const container = document.getElementById('digital-signatures-container');
    const arrow = document.getElementById('sig-manager-arrow');
    if (!container) return;
    const isHidden = container.style.display === 'none' || !container.style.display;
    container.style.display = isHidden ? 'block' : 'none';
    if (arrow) arrow.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
}

function handleSignatureUpload(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    let addedCount = 0;
    const promises = Array.from(files).map(file => {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const dataUrl = e.target.result;
                const cleanKey = cleanNameForMatching(file.name);

                const idx = AppState.digitalSignatures.findIndex(s => s.parsedKey === cleanKey);
                const sigObj = {
                    id: 'sig_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
                    originalName: file.name,
                    parsedKey: cleanKey,
                    dataUrl: dataUrl
                };

                if (idx !== -1) {
                    AppState.digitalSignatures[idx] = sigObj;
                } else {
                    AppState.digitalSignatures.push(sigObj);
                }
                addedCount++;
                resolve();
            };
            reader.readAsDataURL(file);
        });
    });

    Promise.all(promises).then(() => {
        saveDigitalSignatures();
        showNotification(`Se cargaron ${addedCount} firma(s) digital(es) correctamente.`);
        refreshActiveCoursePreview();
    });

    event.target.value = '';
}

function deleteDigitalSignature(id) {
    AppState.digitalSignatures = AppState.digitalSignatures.filter(s => s.id !== id);
    saveDigitalSignatures();
    showNotification("Firma digital eliminada.");
    refreshActiveCoursePreview();
}

function renderDigitalSignaturesList() {
    const badge = document.getElementById('digital-signatures-count-badge');
    const listEl = document.getElementById('digital-signatures-list');
    if (badge) badge.textContent = `${AppState.digitalSignatures.length} registrada(s)`;
    if (!listEl) return;

    if (AppState.digitalSignatures.length === 0) {
        listEl.innerHTML = `<div style="grid-column: 1/-1; text-align:center; font-style:italic; padding:15px; color:var(--text-muted); font-size:12px;">No hay firmas digitales registradas aún.</div>`;
        return;
    }

    listEl.innerHTML = '';
    AppState.digitalSignatures.forEach(s => {
        const card = document.createElement('div');
        card.className = 'sig-card';
        card.innerHTML = `
            <img src="${s.dataUrl}" alt="${s.originalName}">
            <div class="sig-card-info">
                <div class="sig-card-title" title="${s.originalName}">${s.originalName}</div>
                <div class="sig-card-key" title="Clave: ${s.parsedKey}">🔑 ${s.parsedKey || 'Sin clave'}</div>
            </div>
            <button class="btn btn-secondary" onclick="deleteDigitalSignature('${s.id}')" style="padding:4px 8px; font-size:11px; min-height:unset; background:rgba(248, 113, 113, 0.1); border-color:rgba(248, 113, 113, 0.2); color:#fca5a5;">
                ✕
            </button>
        `;
        listEl.appendChild(card);
    });
}

function isSignatureValidForCourseYear(repType, courseDate) {
    if (!courseDate) return true; // Si no hay fecha definida aún, no ocultar la firma por defecto
    const courseYear = courseDate instanceof Date ? courseDate.getFullYear() : new Date(courseDate).getFullYear();
    if (isNaN(courseYear)) return true;

    let startYear = 2021;
    if (repType === 'patron') {
        const inputVal = document.getElementById('config-patron-year');
        startYear = inputVal ? (parseInt(inputVal.value) || 2021) : 2021;
    } else if (repType === 'worker') {
        const inputVal = document.getElementById('config-worker-year');
        startYear = inputVal ? (parseInt(inputVal.value) || 2021) : 2021;
    } else {
        return true;
    }

    return courseYear >= startYear;
}

function renderSigImageOverlay(containerId, personName, isYearValid = true) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!isYearValid) {
        container.innerHTML = '';
        container.style.display = 'none';
        return;
    }

    const sigUrl = findSignatureForName(personName);
    if (sigUrl) {
        container.innerHTML = `<img src="${sigUrl}" class="dc3-sig-img" alt="Firma">`;
        container.style.display = 'flex';
    } else {
        container.innerHTML = '';
        container.style.display = 'none';
    }
}

// Cache for loading files
let rawCreditsWorkers = []; // Workers parsed from CREDITOS

// DOM Elements
const toastEl = document.getElementById('toast');
const toastMsgEl = document.getElementById('toast-msg');
const toastIconPath = document.getElementById('toast-icon-path');

const navBtnGenerate = document.getElementById('nav-btn-generate');
const searchWorkerInput = document.getElementById('search-worker-list');
const filterStatusSelect = document.getElementById('filter-status-select');
const workerListItemsContainer = document.getElementById('worker-list-items');

// Active Worker details elements
const actWorkerName = document.getElementById('act-worker-name');
const actWorkerCurp = document.getElementById('act-worker-curp');
const actWorkerRpeBadge = document.getElementById('act-worker-rpe-badge');
const actWorkerCappa = document.getElementById('act-worker-cappa');
const actWorkerCappi = document.getElementById('act-worker-cappi');
const actWorkerPuestoNum = document.getElementById('act-worker-puesto-num');
const actWorkerCompletedCheckbox = document.getElementById('act-worker-completed-checkbox');

// Table Cursos
const tableCoursesBody = document.getElementById('table-courses-dashboard-body');
const selectedCoursesCountEl = document.getElementById('dash-selected-courses-count');
const btnGenerateSingle = document.getElementById('btn-generate-single');

const selectedCourseIds = new Set();
let activePreviewCourseId = null;

// Toast Helper
function showNotification(message, isError = false) {
    toastMsgEl.textContent = message;
    if (isError) {
        toastEl.classList.add('error');
        toastIconPath.setAttribute('d', 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z');
        playSound('error');
    } else {
        toastEl.classList.remove('error');
        toastIconPath.setAttribute('d', 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z');
        playSound('success');
    }
    toastEl.classList.add('show');
    setTimeout(() => {
        toastEl.classList.remove('show');
    }, 4000);
}

// Helper: Sincronizar trabajadores desde archivos Kardex si no hay lista de créditos
function syncWorkersFromHistory() {
    const historyWorkerNames = Object.keys(AppState.historyFiles);
    if (historyWorkerNames.length === 0) return;

    const existingNamesMap = new Set((AppState.workers || []).map(w => w.name.toUpperCase()));

    let added = false;
    historyWorkerNames.forEach(wName => {
        const cleanName = wName.trim().toUpperCase();
        if (cleanName && !existingNamesMap.has(cleanName)) {
            existingNamesMap.add(cleanName);
            AppState.workers.push({
                name: cleanName,
                curp: '',
                cappa: '',
                cappi: '',
                rpe: '',
                requiredCourses: []
            });
            added = true;
        }
    });

    if (added) {
        AppState.workers.sort((a, b) => String(a.name).localeCompare(String(b.name), 'es', { sensitivity: 'base' }));
        renderWorkerList();
    }
}

// Tab Switching
function switchTab(tabId) {
    if (tabId === 'tab-generate') {
        if (AppState.workers.length === 0 && Object.keys(AppState.historyFiles).length > 0) {
            syncWorkersFromHistory();
        }

        const hasWorkers = AppState.workers.length > 0;
        const hasTemplate = !!AppState.templateFile;

        if (!hasWorkers || !hasTemplate) {
            let missing = [];
            if (!hasWorkers) missing.push("1. Archivo de Créditos (.xlsx) con trabajadores");
            if (!hasTemplate) missing.push("2. Plantilla Word CCHL (.docx)");
            showNotification(`⚠️ No se puede abrir el Generador CCHL.\nFalta cargar: ${missing.join(' y ')}.`, true);
            return;
        }
    }

    playSound('click');
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(panel => panel.classList.remove('active'));

    const activeBtn = Array.from(document.querySelectorAll('.tab-btn')).find(btn => {
        const onclickAttr = btn.getAttribute('onclick');
        return onclickAttr && onclickAttr.includes(tabId);
    });
    if (activeBtn) activeBtn.classList.add('active');

    const activePanel = document.getElementById(tabId);
    if (activePanel) activePanel.classList.add('active');
}

// Enable Generator Tab check
function checkInitState() {
    if (AppState.workers.length === 0 && Object.keys(AppState.historyFiles).length > 0) {
        syncWorkersFromHistory();
    }

    const hasWorkers = AppState.workers.length > 0;
    const hasTemplate = !!AppState.templateFile;

    if (hasWorkers && hasTemplate) {
        if (navBtnGenerate) {
            navBtnGenerate.disabled = false;
            navBtnGenerate.classList.add('ready');
            navBtnGenerate.title = "Ir al Generador CCHL";
        }
    } else {
        if (navBtnGenerate) {
            navBtnGenerate.disabled = false; // Permite el clic para informar al usuario
            navBtnGenerate.classList.remove('ready');
            let reasons = [];
            if (!hasWorkers) reasons.push("Falta Archivo de Créditos (.xlsx)");
            if (!hasTemplate) reasons.push("Falta Plantilla Word (.docx)");
            navBtnGenerate.title = `⚠️ Requerido: ${reasons.join(', ')}`;
        }
    }
}

// Initialize Upload Zones
function setupUploadZone(zoneId, inputId, parseCallback) {
    const zone = document.getElementById(zoneId);
    const input = document.getElementById(inputId);

    zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        zone.classList.add('dragover');
    });

    zone.addEventListener('dragleave', () => {
        zone.classList.remove('dragover');
    });

    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            input.files = e.dataTransfer.files;
            handleFileSelect(input.files, zone, parseCallback);
        }
    });

    input.addEventListener('change', () => {
        if (input.files.length > 0) {
            handleFileSelect(input.files, zone, parseCallback);
        }
    });
}

function handleFileSelect(files, zone, parseCallback) {
    const file = files[0];
    if (!file) return;

    zone.classList.add('success');
    let fnEl = zone.querySelector('.file-name');
    if (!fnEl) {
        fnEl = document.createElement('div');
        fnEl.className = 'file-name';
        zone.appendChild(fnEl);
    }
    fnEl.textContent = file.name;
    const descEl = zone.querySelector('.desc');
    if (descEl) descEl.style.display = 'none';

    parseCallback(files);
}

// Clean Course name helper to ensure fuzzy match
function cleanCourseName(name) {
    if (!name) return '';
    return name.toString()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // remove accents
        .toUpperCase()
        // Remove leading alphanumeric codes (at least 4 characters long, containing at least one digit)
        .replace(/^(?=[A-Z0-9\.\-_]*\d)[A-Z0-9\.\-_]{4,}\s+/g, '')
        .replace(/^[\d\s\.\-_]+/g, '')   // remove leading numbers/spaces/points/hyphens/underscores
        .replace(/[^A-Z0-9\s]/g, '')     // keep alphanumeric and spaces
        .replace(/\s+/g, ' ')            // normalize spacing
        .trim();
}

function stripLegacyInstructorPrefix(name) {
    return String(name || '')
        .replace(/^\s*ING(?:ENIERO)?\.?\s+/i, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();
}

function normalizeInstructorCatalog(names, stripLegacyPrefix = false) {
    const seen = new Set();
    const normalized = [];
    (names || []).forEach(name => {
        const clean = stripLegacyPrefix
            ? stripLegacyInstructorPrefix(name)
            : String(name || '').replace(/\s+/g, ' ').trim().toUpperCase();
        if (clean && !seen.has(clean)) {
            seen.add(clean);
            normalized.push(clean);
        }
    });
    return normalized;
}

function pickRandomInstructor(excludeName = '') {
    const available = AppState.instructors.filter(inst => inst !== excludeName);
    if (available.length === 0) return '';
    const randIdx = Math.floor(Math.random() * available.length);
    return available[randIdx];
}

function refreshActiveCoursePreview() {
    if (!AppState.selectedWorker || activePreviewCourseId === null) return;
    const current = AppState.workerCoursesList.find(c => c.id === activePreviewCourseId);
    if (current) {
        selectCourseForPreview(current);
    }
}

// Setup local storage key loaders
function loadStaticConfig() {
    const minYear = localStorage.getItem('cfe_rand_min_year');
    const maxYear = localStorage.getItem('cfe_rand_max_year');

    if (minYear) document.getElementById('config-rand-min-year').value = minYear;
    if (maxYear) document.getElementById('config-rand-max-year').value = maxYear;

    // Bind change listeners to save config with validation
    ['config-rand-min-year', 'config-rand-max-year'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', (e) => {
                const val = parseInt(e.target.value);
                if (isNaN(val) || val < 1900 || val > 2100) {
                    showNotification("Por favor ingresa un año válido entre 1900 y 2100.", true);
                    e.target.style.borderColor = 'var(--danger)';
                    return;
                }
                e.target.style.borderColor = 'var(--glass-border)';

                const minEl = document.getElementById('config-rand-min-year');
                const maxEl = document.getElementById('config-rand-max-year');
                const minVal = parseInt(minEl.value);
                const maxVal = parseInt(maxEl.value);

                if (!isNaN(minVal) && !isNaN(maxVal) && minVal > maxVal) {
                    showNotification("El año inicial no puede ser mayor que el año final.", true);
                    minEl.style.borderColor = 'var(--danger)';
                    maxEl.style.borderColor = 'var(--danger)';
                    return;
                }

                minEl.style.borderColor = 'var(--glass-border)';
                maxEl.style.borderColor = 'var(--glass-border)';

                const key = id.replace(/-/g, '_').replace('config_', 'cfe_');
                localStorage.setItem(key, e.target.value);
            });
        }
    });

    // Load profiles CRUD
    loadProfilesConfig();

    // Load Digital Signatures
    loadDigitalSignatures();

    // Load Instructors Catalog
    const storedInst = localStorage.getItem('cfe_instructors_catalog');
    const shouldStripLegacyPrefix = localStorage.getItem('cfe_instructors_prefix_cleaned_v1') !== 'true';
    if (storedInst) {
        try {
            AppState.instructors = normalizeInstructorCatalog(JSON.parse(storedInst), shouldStripLegacyPrefix);
        } catch (e) {
            console.warn("Catálogo de instructores inválido en memoria local. Se restauran los valores predeterminados.", e);
            AppState.instructors = normalizeInstructorCatalog(DEFAULT_INSTRUCTORS, shouldStripLegacyPrefix);
        }
    } else {
        AppState.instructors = normalizeInstructorCatalog(DEFAULT_INSTRUCTORS, shouldStripLegacyPrefix);
    }
    localStorage.setItem('cfe_instructors_catalog', JSON.stringify(AppState.instructors));
    localStorage.setItem('cfe_instructors_prefix_cleaned_v1', 'true');

    updateInstructorsDatalist();
    renderInstructorsManager();
}

// Validation functions
function validateWorkerData(worker) {
    const wCurp = worker.curp || '';
    const curpErrorEl = document.getElementById('act-worker-curp-error');
    const cleanCurp = wCurp.trim().toUpperCase();

    // Check if CURP is empty or has invalid length
    if (!cleanCurp) {
        curpErrorEl.textContent = "⚠️ CURP no asignada";
        curpErrorEl.style.display = 'block';
    } else if (!/^[A-Z0-9]{18}$/.test(cleanCurp)) {
        curpErrorEl.textContent = "⚠️ CURP Inválida (debe tener 18 caracteres alfanuméricos)";
        curpErrorEl.style.display = 'block';
    } else {
        curpErrorEl.style.display = 'none';
    }

    const puestoInput = document.getElementById('act-worker-puesto-num');
    validatePuestoNumInput(puestoInput.value);
}

function validatePuestoNumInput(val) {
    const puestoErrorEl = document.getElementById('act-worker-puesto-error');
    const puestoInput = document.getElementById('act-worker-puesto-num');
    const cleanVal = val.trim();

    if (!cleanVal) {
        puestoErrorEl.textContent = "⚠️ El puesto no puede estar vacío";
        puestoErrorEl.style.display = 'block';
        puestoInput.style.borderColor = 'var(--danger)';
    } else if (!/^\d+$/.test(cleanVal)) {
        puestoErrorEl.textContent = "⚠️ El puesto debe contener solo dígitos";
        puestoErrorEl.style.display = 'block';
        puestoInput.style.borderColor = 'var(--danger)';
    } else {
        puestoErrorEl.style.display = 'none';
        puestoInput.style.borderColor = 'var(--glass-border)';
    }
}

// CRUD for Representative Profiles
function loadProfilesConfig() {
    const storedProfiles = localStorage.getItem('cfe_rep_profiles');
    if (storedProfiles) {
        try {
            AppState.profiles = JSON.parse(storedProfiles);
            AppState.profiles.forEach(p => {
                if (!p.patronStartYear) p.patronStartYear = 2021;
                if (!p.workerStartYear) p.workerStartYear = 2021;
            });
        } catch (e) {
            AppState.profiles = [];
        }
    }

    if (!AppState.profiles || AppState.profiles.length === 0) {
        // Initialize default profile using current config values or hardcoded fallbacks
        const defaultPatron = localStorage.getItem('cfe_patron_rep') || "JOSE DAVID LOPEZ MEDINA";
        const defaultWorker = localStorage.getItem('cfe_worker_rep') || "JUAN CARLOS SERNA GOMEZ";
        const defaultCompany = localStorage.getItem('cfe_company') || "COMISIÓN FEDERAL DE ELECTRICIDAD";

        AppState.profiles = [
            {
                id: 'default_cfe',
                name: 'CFE - Configuración General',
                patronRep: defaultPatron,
                workerRep: defaultWorker,
                company: defaultCompany,
                patronStartYear: 2021,
                workerStartYear: 2021,
                active: true
            }
        ];
        localStorage.setItem('cfe_rep_profiles', JSON.stringify(AppState.profiles));
    }

    // Find active profile or set first as active
    let activeProfile = AppState.profiles.find(p => p.active);
    if (!activeProfile && AppState.profiles.length > 0) {
        AppState.profiles[0].active = true;
        activeProfile = AppState.profiles[0];
        localStorage.setItem('cfe_rep_profiles', JSON.stringify(AppState.profiles));
    }

    AppState.activeProfileId = activeProfile ? activeProfile.id : null;
    applyActiveProfileValues(activeProfile);
    renderProfilesCRUD();
}

function applyActiveProfileValues(profile) {
    if (!profile) return;

    const patronYr = profile.patronStartYear || 2021;
    const workerYr = profile.workerStartYear || 2021;

    // Set values on hidden config inputs
    document.getElementById('config-patron-rep').value = profile.patronRep;
    document.getElementById('config-worker-rep').value = profile.workerRep;
    document.getElementById('config-company').value = profile.company;
    const patronYrEl = document.getElementById('config-patron-year');
    const workerYrEl = document.getElementById('config-worker-year');
    if (patronYrEl) patronYrEl.value = patronYr;
    if (workerYrEl) workerYrEl.value = workerYr;

    // Save individual keys for compatibility
    localStorage.setItem('cfe_patron_rep', profile.patronRep);
    localStorage.setItem('cfe_worker_rep', profile.workerRep);
    localStorage.setItem('cfe_company', profile.company);
    localStorage.setItem('cfe_patron_year', patronYr);
    localStorage.setItem('cfe_worker_year', workerYr);

    // Re-render live preview if active worker/course exists
    if (AppState.selectedWorker && AppState.workerCoursesList.length > 0 && activePreviewCourseId !== null) {
        const current = AppState.workerCoursesList.find(c => c.id === activePreviewCourseId);
        if (current) selectCourseForPreview(current);
    }
}

function renderProfilesCRUD() {
    const selectEl = document.getElementById('config-profile-select');
    const tbodyEl = document.getElementById('profiles-table-body');
    if (!selectEl || !tbodyEl) return;

    // 1. Render dropdown selector
    selectEl.innerHTML = '';
    AppState.profiles.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        opt.selected = (p.id === AppState.activeProfileId);
        selectEl.appendChild(opt);
    });

    // 2. Render CRUD table
    tbodyEl.innerHTML = '';
    if (AppState.profiles.length === 0) {
        tbodyEl.innerHTML = `<tr><td colspan="6" style="text-align:center; font-style:italic; padding:15px; color:var(--text-muted);">No hay perfiles de firmas registrados.</td></tr>`;
        return;
    }

    AppState.profiles.forEach(p => {
        const tr = document.createElement('tr');
        if (p.id === AppState.activeProfileId) {
            tr.className = 'active-row';
        }

        const pYr = p.patronStartYear || 2021;
        const wYr = p.workerStartYear || 2021;

        tr.innerHTML = `
            <td style="text-align:center;">
                <label class="checkbox-container" style="padding-left:18px; display:inline-block;">
                    <input type="radio" name="active-profile-radio" ${p.id === AppState.activeProfileId ? 'checked' : ''} onchange="selectActiveProfile('${p.id}')">
                    <span class="checkmark" style="height:14px; width:14px; border-radius:50%;"></span>
                </label>
            </td>
            <td style="font-weight:600; font-size:12px;">${p.name}</td>
            <td>${p.patronRep} <span style="font-size:10px; color:var(--text-muted);">(≥${pYr})</span></td>
            <td>${p.workerRep} <span style="font-size:10px; color:var(--text-muted);">(≥${wYr})</span></td>
            <td style="font-size:11px; max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${p.company}">${p.company}</td>
            <td style="text-align:center;">
                <div style="display:inline-flex; gap:6px;">
                    <button class="btn btn-secondary" onclick="editProfile('${p.id}')" style="padding:4px 8px; font-size:11px; min-height:unset;">
                        Editar
                    </button>
                    <button class="btn btn-secondary" onclick="deleteProfile('${p.id}')" style="padding:4px 8px; font-size:11px; min-height:unset; background:rgba(248, 113, 113, 0.1); border-color:rgba(248, 113, 113, 0.2); color:#fca5a5;" ${p.id === 'default_cfe' ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : ''}>
                        Borrar
                    </button>
                </div>
            </td>
        `;
        tbodyEl.appendChild(tr);
    });
}

function selectActiveProfile(profileId) {
    playSound('click');
    AppState.profiles.forEach(p => {
        p.active = (p.id === profileId);
    });
    AppState.activeProfileId = profileId;
    localStorage.setItem('cfe_rep_profiles', JSON.stringify(AppState.profiles));

    const activeProfile = AppState.profiles.find(p => p.active);
    applyActiveProfileValues(activeProfile);
    renderProfilesCRUD();
    showNotification(`Perfil de firmas "${activeProfile.name}" activado.`);
}

function saveProfile() {
    const idInput = document.getElementById('edit-profile-id');
    const nameInput = document.getElementById('profile-form-name');
    const patronInput = document.getElementById('profile-form-patron');
    const patronYrInput = document.getElementById('profile-form-patron-year');
    const workerInput = document.getElementById('profile-form-worker');
    const workerYrInput = document.getElementById('profile-form-worker-year');
    const companyInput = document.getElementById('profile-form-company');

    const name = nameInput.value.trim().toUpperCase();
    const patron = patronInput.value.trim().toUpperCase();
    const patronStartYear = parseInt(patronYrInput.value) || 2021;
    const worker = workerInput.value.trim().toUpperCase();
    const workerStartYear = parseInt(workerYrInput.value) || 2021;
    const company = companyInput.value.trim().toUpperCase();

    // Validations for CRUD fields
    if (!name) {
        showNotification("El nombre del perfil es requerido.", true);
        nameInput.style.borderColor = 'var(--danger)';
        return;
    } else { nameInput.style.borderColor = 'var(--glass-border)'; }

    if (!patron) {
        showNotification("El representante del patrón es requerido.", true);
        patronInput.style.borderColor = 'var(--danger)';
        return;
    } else { patronInput.style.borderColor = 'var(--glass-border)'; }

    if (!worker) {
        showNotification("El representante de los trabajadores es requerido.", true);
        workerInput.style.borderColor = 'var(--danger)';
        return;
    } else { workerInput.style.borderColor = 'var(--glass-border)'; }

    if (!company) {
        showNotification("La razón social es requerida.", true);
        companyInput.style.borderColor = 'var(--danger)';
        return;
    } else { companyInput.style.borderColor = 'var(--glass-border)'; }

    playSound('success');
    const profileId = idInput.value;

    if (profileId) {
        // Edit existing
        const idx = AppState.profiles.findIndex(p => p.id === profileId);
        if (idx !== -1) {
            AppState.profiles[idx].name = name;
            AppState.profiles[idx].patronRep = patron;
            AppState.profiles[idx].patronStartYear = patronStartYear;
            AppState.profiles[idx].workerRep = worker;
            AppState.profiles[idx].workerStartYear = workerStartYear;
            AppState.profiles[idx].company = company;
            showNotification(`Perfil "${name}" actualizado.`);
        }
    } else {
        // Add new
        const newId = 'profile_' + Date.now();
        AppState.profiles.push({
            id: newId,
            name: name,
            patronRep: patron,
            patronStartYear: patronStartYear,
            workerRep: worker,
            workerStartYear: workerStartYear,
            company: company,
            active: false
        });
        showNotification(`Perfil "${name}" creado correctamente.`);
    }

    localStorage.setItem('cfe_rep_profiles', JSON.stringify(AppState.profiles));
    cancelProfileEdit();

    // If editing the active one, apply changes
    const activeProfile = AppState.profiles.find(p => p.active);
    if (activeProfile) {
        applyActiveProfileValues(activeProfile);
    }
    renderProfilesCRUD();
}

function editProfile(profileId) {
    playSound('click');
    const profile = AppState.profiles.find(p => p.id === profileId);
    if (!profile) return;

    document.getElementById('edit-profile-id').value = profile.id;
    document.getElementById('profile-form-name').value = profile.name;
    document.getElementById('profile-form-patron').value = profile.patronRep;
    document.getElementById('profile-form-patron-year').value = profile.patronStartYear || 2021;
    document.getElementById('profile-form-worker').value = profile.workerRep;
    document.getElementById('profile-form-worker-year').value = profile.workerStartYear || 2021;
    document.getElementById('profile-form-company').value = profile.company;

    document.getElementById('profile-form-title-text').textContent = `Editar Perfil: ${profile.name}`;
    document.getElementById('profile-form-icon-path').setAttribute('d', 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z');
    document.getElementById('btn-cancel-profile').style.display = 'inline-block';

    // Reset borders
    ['profile-form-name', 'profile-form-patron', 'profile-form-worker', 'profile-form-company'].forEach(id => {
        document.getElementById(id).style.borderColor = 'var(--glass-border)';
    });

    // Focus name input
    document.getElementById('profile-form-name').focus();
}

function deleteProfile(profileId) {
    if (profileId === 'default_cfe') {
        showNotification("No se puede eliminar el perfil predeterminado.", true);
        return;
    }

    playSound('click');
    const profile = AppState.profiles.find(p => p.id === profileId);
    if (!profile) return;

    if (confirm(`¿Estás seguro de que deseas eliminar el perfil "${profile.name}"?`)) {
        const isDeletedActive = profile.active;
        AppState.profiles = AppState.profiles.filter(p => p.id !== profileId);

        if (isDeletedActive && AppState.profiles.length > 0) {
            AppState.profiles[0].active = true;
            AppState.activeProfileId = AppState.profiles[0].id;
            applyActiveProfileValues(AppState.profiles[0]);
        }

        localStorage.setItem('cfe_rep_profiles', JSON.stringify(AppState.profiles));
        renderProfilesCRUD();
        showNotification(`Perfil "${profile.name}" eliminado.`);
    }
}

function cancelProfileEdit() {
    document.getElementById('edit-profile-id').value = '';
    document.getElementById('profile-form-name').value = '';
    document.getElementById('profile-form-patron').value = '';
    document.getElementById('profile-form-patron-year').value = 2021;
    document.getElementById('profile-form-worker').value = '';
    document.getElementById('profile-form-worker-year').value = 2021;
    document.getElementById('profile-form-company').value = '';

    document.getElementById('profile-form-title-text').textContent = 'Crear Nuevo Perfil de Firmas';
    document.getElementById('profile-form-icon-path').setAttribute('d', 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z');
    document.getElementById('btn-cancel-profile').style.display = 'none';

    ['profile-form-name', 'profile-form-patron', 'profile-form-worker', 'profile-form-company'].forEach(id => {
        document.getElementById(id).style.borderColor = 'var(--glass-border)';
    });
}

function updateInstructorsDatalist() {
    let datalist = document.getElementById('instructors-list');
    if (!datalist) {
        datalist = document.createElement('datalist');
        datalist.id = 'instructors-list';
        document.body.appendChild(datalist);
    }
    datalist.innerHTML = '';
    AppState.instructors.forEach(inst => {
        const opt = document.createElement('option');
        opt.value = inst;
        datalist.appendChild(opt);
    });
}

function syncInstructorReferences(oldName, replacementName = '') {
    if (!AppState.selectedWorker) return;

    AppState.workerCoursesList.forEach(course => {
        let changed = false;

        if (course.instructorMode === 'manual' && course.manualInstructor === oldName) {
            if (replacementName) {
                course.manualInstructor = replacementName;
            } else {
                course.instructorMode = 'random';
                course.randomInstructor = pickRandomInstructor(oldName);
                course.manualInstructor = course.randomInstructor;
            }
            changed = true;
        }

        if (course.randomInstructor === oldName) {
            course.randomInstructor = replacementName || pickRandomInstructor(oldName);
            if (course.instructorMode === 'random') {
                course.manualInstructor = course.randomInstructor;
            }
            changed = true;
        }

        if (changed) {
            saveCourseState(AppState.selectedWorker.name, course);
        }
    });
}

function renderInstructorsManager() {
    const listContainer = document.getElementById('instructors-interactive-list');
    const countEl = document.getElementById('instructors-count');
    if (!listContainer) return;

    listContainer.innerHTML = '';
    countEl.textContent = AppState.instructors.length;

    if (AppState.instructors.length === 0) {
        listContainer.innerHTML = `<div style="text-align: center; color: var(--text-muted); font-style: italic; padding: 15px; font-size: 12px;">No hay instructores en el catálogo.</div>`;
        return;
    }

    AppState.instructors.forEach((inst, idx) => {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.gap = '8px';
        row.style.background = 'rgba(255, 255, 255, 0.02)';
        row.style.border = '1px solid var(--glass-border)';
        row.style.borderRadius = '8px';
        row.style.padding = '4px 8px';

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'input-control';
        input.value = inst;
        input.style.padding = '4px 8px';
        input.style.fontSize = '12px';
        input.style.fontWeight = '600';
        input.style.flex = '1';
        input.addEventListener('change', () => editInstructor(idx, input.value));

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn btn-secondary';
        deleteBtn.title = 'Eliminar';
        deleteBtn.style.padding = '6px';
        deleteBtn.style.minHeight = 'unset';
        deleteBtn.style.background = 'rgba(248, 113, 113, 0.1)';
        deleteBtn.style.borderColor = 'rgba(248, 113, 113, 0.2)';
        deleteBtn.style.color = '#fca5a5';
        deleteBtn.style.flexShrink = '0';
        deleteBtn.innerHTML = `
                <svg viewBox="0 0 24 24" style="width:14px; height:14px; fill:currentColor;">
                    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                </svg>
        `;
        deleteBtn.addEventListener('click', () => deleteInstructor(idx));

        row.appendChild(input);
        row.appendChild(deleteBtn);
        listContainer.appendChild(row);
    });
}

function addNewInstructor() {
    const input = document.getElementById('new-instructor-name');
    const name = normalizeInstructorCatalog([input.value])[0] || '';
    if (!name) {
        showNotification("Escribe el nombre del instructor.", true);
        return;
    }
    if (AppState.instructors.includes(name)) {
        showNotification("Este instructor ya se encuentra en el catálogo.", true);
        return;
    }

    AppState.instructors.push(name);
    localStorage.setItem('cfe_instructors_catalog', JSON.stringify(AppState.instructors));
    input.value = '';

    updateInstructorsDatalist();
    renderInstructorsManager();

    if (AppState.selectedWorker) {
        renderCoursesTableForActiveWorker();
    }

    showNotification(`Instructor "${name}" agregado correctamente.`);
}

function editInstructor(index, newValue) {
    const val = normalizeInstructorCatalog([newValue])[0] || '';
    if (!val) {
        showNotification("El nombre no puede estar vacío.", true);
        renderInstructorsManager();
        return;
    }

    const oldName = AppState.instructors[index];
    if (oldName === val) return;
    if (AppState.instructors.some((inst, idx) => idx !== index && inst === val)) {
        showNotification("Este instructor ya se encuentra en el catálogo.", true);
        renderInstructorsManager();
        return;
    }

    AppState.instructors[index] = val;
    syncInstructorReferences(oldName, val);
    localStorage.setItem('cfe_instructors_catalog', JSON.stringify(AppState.instructors));

    updateInstructorsDatalist();
    renderInstructorsManager();

    if (AppState.selectedWorker) {
        renderCoursesTableForActiveWorker();
        refreshActiveCoursePreview();
    }

    showNotification("Instructor actualizado.");
}

function deleteInstructor(index) {
    const name = AppState.instructors[index];
    AppState.instructors.splice(index, 1);
    syncInstructorReferences(name);
    localStorage.setItem('cfe_instructors_catalog', JSON.stringify(AppState.instructors));

    updateInstructorsDatalist();
    renderInstructorsManager();

    if (AppState.selectedWorker) {
        renderCoursesTableForActiveWorker();
        refreshActiveCoursePreview();
    }

    showNotification(`Instructor "${name}" eliminado.`);
}

// Process workers data from CREDITOS
function mergeWorkersData() {
    if (rawCreditsWorkers.length === 0) return;

    AppState.workers = JSON.parse(JSON.stringify(rawCreditsWorkers)).sort((a, b) => {
        return String(a.name || '').localeCompare(String(b.name || ''), 'es', { sensitivity: 'base' });
    });
    renderWorkerList();
    checkInitState();
}

// 2. CREDITOS
// Helpers to manage upload zones visual state
function setUploadZoneLoaded(zoneId, fileName) {
    const zone = document.getElementById(zoneId);
    if (!zone) return;
    zone.classList.add('success');
    let fnEl = zone.querySelector('.file-name');
    if (!fnEl) {
        fnEl = document.createElement('div');
        fnEl.className = 'file-name';
        zone.appendChild(fnEl);
    }
    fnEl.textContent = fileName;

    let hintEl = zone.querySelector('.change-hint');
    if (!hintEl) {
        hintEl = document.createElement('p');
        hintEl.className = 'change-hint';
        hintEl.style.fontSize = '10px';
        hintEl.style.color = 'var(--text-muted)';
        hintEl.style.opacity = '0.7';
        hintEl.style.marginTop = '4px';
        hintEl.textContent = '(Haz clic o arrastra un nuevo archivo para reemplazar)';
        zone.appendChild(hintEl);
    }

    const descEl = zone.querySelector('.desc');
    if (descEl) descEl.style.display = 'none';
}

function resetUploadZone(zoneId, defaultDesc) {
    const zone = document.getElementById(zoneId);
    if (!zone) return;
    zone.classList.remove('success');
    const fnEl = zone.querySelector('.file-name');
    if (fnEl) zone.removeChild(fnEl);
    const hintEl = zone.querySelector('.change-hint');
    if (hintEl) zone.removeChild(hintEl);
    const descEl = zone.querySelector('.desc');
    if (descEl) {
        descEl.textContent = defaultDesc;
        descEl.style.display = 'block';
    }
    const input = zone.querySelector('input[type="file"]');
    if (input) input.value = '';
}

// 2. CREDITOS
function processCreditsFile(fileBuffer, fileName) {
    try {
        extractSignaturesFromExcelBuffer(fileBuffer, fileName);
        const data = new Uint8Array(fileBuffer);
        const workbook = XLSX.read(data, { type: 'array' });

        let workersMap = {};

        // Buscar hojas específicas (CAPPA / CAPPI / ACTUAL / INMEDIATO)
        let targetSheets = workbook.SheetNames.filter(sheetName => {
            const upper = sheetName.toUpperCase();
            return upper.includes('CAPPA') || upper.includes('ACTUAL') || upper.includes('CAPPI') || upper.includes('INMEDIATO');
        });

        // Si no existen pestañas con esos nombres exactos, analizar TODAS las pestañas del libro
        if (targetSheets.length === 0) {
            targetSheets = workbook.SheetNames;
        }

        targetSheets.forEach(sheetName => {
            const upperSheet = sheetName.toUpperCase();
            let type = 'CAPPA';
            if (upperSheet.includes('CAPPI') || upperSheet.includes('INMEDIATO')) {
                type = 'CAPPI';
            }

            const worksheet = workbook.Sheets[sheetName];
            const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
            if (!rawRows || rawRows.length === 0) return;

            // Encontrar fila de encabezados en las primeras 10 filas
            let headerRowIdx = -1;
            let headerRow = [];
            for (let i = 0; i < Math.min(10, rawRows.length); i++) {
                const row = rawRows[i];
                if (row && row.some(cell => {
                    const val = String(cell || '').toUpperCase();
                    return val.includes('CURP') || val.includes('NOMBRE') || val.includes('CURSO') || val.includes('RPE') || val.includes('RPU');
                })) {
                    headerRowIdx = i;
                    headerRow = row;
                    break;
                }
            }

            if (headerRowIdx === -1) {
                headerRowIdx = 0;
                headerRow = rawRows[0] || [];
            }

            let nameColIdx = headerRow.findIndex(h => {
                const val = String(h || '').toUpperCase();
                return val.includes('NOMBRE') || val.includes('COMPLETO') || val.includes('TRABAJADOR');
            });
            if (nameColIdx === -1) nameColIdx = 1; // Columna B

            let curpColIdx = headerRow.findIndex(h => String(h || '').toUpperCase().includes('CURP'));
            if (curpColIdx === -1) curpColIdx = 2; // Columna C

            let rpeColIdx = headerRow.findIndex(h => {
                const val = String(h || '').toUpperCase();
                return val.includes('RPE') || val.includes('RPU') || val.includes('REGISTRO');
            });
            if (rpeColIdx === -1) rpeColIdx = 0; // Columna A (RPE/RPU)

            let puestoColIdx = headerRow.findIndex(h => {
                const val = String(h || '').toUpperCase();
                return val.includes('BATERIA') || val.includes('PUESTO');
            });
            if (puestoColIdx === -1) puestoColIdx = 3; // Columna D (NOMBRE DE BATERIA)

            let courseColIdx = headerRow.findIndex(h => {
                const val = String(h || '').toUpperCase();
                return val.includes('CURSO') || val.includes('MATERIA') || val.includes('NOMBRE DEL CURSO');
            });
            if (courseColIdx === -1) courseColIdx = 4; // Columna E (NOMBRE DEL CURSO)

            let hoursColIdx = headerRow.findIndex(h => {
                const val = String(h || '').toUpperCase();
                return val.includes('HORAS') || val.includes('DURACION') || val.includes('HORAS TOTALES');
            });
            if (hoursColIdx === -1) hoursColIdx = 5; // Columna F (HORAS TOTALES DEL CURSO)

            let areaColIdx = headerRow.findIndex(h => {
                const val = String(h || '').toUpperCase();
                return val.includes('AREA') || val.includes('TEMATICA');
            });

            // Start reading from row after the header row
            for (let r = headerRowIdx + 1; r < rawRows.length; r++) {
                const row = rawRows[r];
                if (!row || row.length === 0) continue;

                let name = nameColIdx < row.length ? String(row[nameColIdx] || '').trim().toUpperCase() : '';
                if (!name || name === 'NOMBRE COMPLETO' || name === 'NOMBRE' || name === 'APELLIDO' || name === 'TRABAJADOR') continue;

                let curp = curpColIdx < row.length ? String(row[curpColIdx] || '').trim().toUpperCase() : '';
                let rpe = rpeColIdx < row.length ? String(row[rpeColIdx] || '').trim().toUpperCase() : '';
                let puestoVal = puestoColIdx < row.length ? String(row[puestoColIdx] || '').trim().toUpperCase() : '';

                let courseName = courseColIdx < row.length ? String(row[courseColIdx] || '').trim() : '';
                let hours = hoursColIdx < row.length ? parseInt(row[hoursColIdx]) || 8 : 8;
                let area = (areaColIdx !== -1 && areaColIdx < row.length) ? String(row[areaColIdx] || '2600-EDUCACION').trim() : '2600-EDUCACION';

                if (curp === 'CURP' || puestoVal === 'PUESTO' || courseName === 'CURSO' || courseName === 'NOMBRE DEL CURSO') continue;

                if (!workersMap[name]) {
                    workersMap[name] = {
                        name: name,
                        curp: curp,
                        cappa: '',
                        cappi: '',
                        rpe: rpe,
                        requiredCourses: []
                    };
                }

                if (curp && !workersMap[name].curp) workersMap[name].curp = curp;
                if (rpe && !workersMap[name].rpe) workersMap[name].rpe = rpe;

                if (type === 'CAPPA') {
                    workersMap[name].cappa = puestoVal;
                } else if (type === 'CAPPI') {
                    workersMap[name].cappi = puestoVal;
                }

                if (courseName) {
                    const isDup = workersMap[name].requiredCourses.some(rc =>
                        rc.name.toUpperCase() === courseName.toUpperCase() && rc.puestoType === type
                    );
                    if (!isDup) {
                        workersMap[name].requiredCourses.push({
                            name: courseName,
                            hours: hours,
                            area: area,
                            puestoType: type
                        });
                    }
                }
            }
        });

        rawCreditsWorkers = Object.values(workersMap);

        if (rawCreditsWorkers.length === 0) {
            showNotification(`⚠️ No se encontraron trabajadores en "${fileName}". Verifica el contenido del Excel.`, true);
            resetUploadZone('zone-courses', 'Arrastra el archivo de Créditos (CAPPA/CAPPI) o haz clic para buscar');
        } else {
            showNotification(`Se cargaron ${rawCreditsWorkers.length} trabajadores de Créditos.`);
            setUploadZoneLoaded('zone-courses', fileName);
            mergeWorkersData();
        }

        // continuity: check last selected worker
        const lastWorkerName = localStorage.getItem('cfe_last_selected_worker');
        if (lastWorkerName && AppState.workers.length > 0) {
            const worker = AppState.workers.find(w => w.name === lastWorkerName);
            if (worker) {
                setTimeout(() => {
                    selectWorker(worker, false);
                }, 100);
            }
        }
    } catch (err) {
        showNotification(`Error al leer CREDITOS: ${err.message}`, true);
    }
}

setupUploadZone('zone-courses', 'input-courses', (files) => {
    const file = files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        const buffer = e.target.result;
        processCreditsFile(buffer, file.name);
        await saveAsset('credits_file', file.name, buffer);
    };
    reader.readAsArrayBuffer(file);
});

function updateInstructorsList(namesArray) {
    AppState.instructors = namesArray.map(name => name.trim().toUpperCase()).filter(name => name.length > 0);
    localStorage.setItem('cfe_instructors_catalog', JSON.stringify(AppState.instructors));

    updateInstructorsDatalist();
    renderInstructorsManager();
    if (AppState.selectedWorker) {
        renderCoursesTableForActiveWorker();
    }
}

// 4. Plantilla de Word (.docx)
function processTemplateFile(fileBuffer, fileName) {
    AppState.templateFile = fileBuffer;
    showNotification("Plantilla de Word cargada correctamente.");

    try {
        const zipContent = preprocessTemplateXml(AppState.templateFile);
        let docXml = "";
        if (zipContent.files["word/document.xml"]) {
            docXml = zipContent.files["word/document.xml"].asText();
        }
        const cleanText = docXml.replace(/<[^>]+>/g, "");
        const matches = cleanText.match(/«[^»]+»/g) || [];
        const uniqueTags = [...new Set(matches)].map(t => t.replace(/[«»]/g, "")).sort();

        const container = document.getElementById('detected-tags-container');
        const label = document.getElementById('detected-tags-label');
        if (container) {
            container.innerHTML = '';
            if (uniqueTags.length > 0) {
                label.style.display = 'block';
                uniqueTags.forEach(tag => {
                    const badge = document.createElement('span');
                    badge.className = 'badge';
                    badge.style.margin = '3px';
                    badge.style.background = 'rgba(255, 255, 255, 0.04)';
                    badge.style.border = '1px solid var(--glass-border)';
                    badge.style.color = '#ffffff';
                    badge.style.fontFamily = 'monospace';
                    badge.textContent = `«${tag}»`;
                    container.appendChild(badge);
                });
            }
        }
    } catch (err) {
        console.warn("No se pudieron extraer variables de la plantilla:", err);
    }
    setUploadZoneLoaded('zone-template', fileName);
    checkInitState();
}

setupUploadZone('zone-template', 'input-template', (files) => {
    const file = files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        const buffer = e.target.result;
        processTemplateFile(buffer, file.name);
        await saveAsset('template_file', file.name, buffer);
    };
    reader.readAsArrayBuffer(file);
});

// 5. Multiple worker KARDEX history files
const zoneHistory = document.getElementById('zone-worker-history');
const inputHistory = document.getElementById('input-worker-history');
const statusTextHistory = document.getElementById('status-text-history');
const statusDotHistory = document.getElementById('status-dot-history');

zoneHistory.addEventListener('dragover', (e) => {
    e.preventDefault();
    zoneHistory.classList.add('dragover');
});
zoneHistory.addEventListener('dragleave', () => {
    zoneHistory.classList.remove('dragover');
});
zoneHistory.addEventListener('drop', (e) => {
    e.preventDefault();
    zoneHistory.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
        inputHistory.files = e.dataTransfer.files;
        parseHistoryFiles(inputHistory.files);
    }
});
inputHistory.addEventListener('change', () => {
    if (inputHistory.files.length > 0) {
        parseHistoryFiles(inputHistory.files);
    }
});

async function parseHistoryFiles(files) {
    let processed = 0;
    let total = files.length;
    zoneHistory.classList.add('success');

    const filesArray = Array.from(files);
    for (const file of filesArray) {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                
                let selectedSheet = null;
                let rawRows = [];

                // Search all sheets in workbook for Kardex columns
                for (const sheetName of workbook.SheetNames) {
                    const sheet = workbook.Sheets[sheetName];
                    
                    let rows = [];
                    if (sheet['!ref']) {
                        const range = XLSX.utils.decode_range(sheet['!ref']);
                        range.s.c = 0; // Force parse starting at Column A
                        rows = XLSX.utils.sheet_to_json(sheet, { header: 1, range: range });
                    } else {
                        rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
                    }
                    
                    let hasCourse = false;
                    let hasDate = false;

                    for (let i = 0; i < Math.min(25, rows.length); i++) {
                        const row = rows[i];
                        if (row) {
                            const hasCourseHeader = row.some(cell => {
                                const val = String(cell || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
                                return val.includes('CURSO') || val.includes('MATERIA') || val.includes('NOMBRE DEL CURSO');
                            });
                            const hasDateHeader = row.some(cell => {
                                const val = String(cell || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
                                return val.includes('FECHA') || (val.includes('ACREDITAC') && !val.includes('MODO')) || val.includes('TERMINO') || val.includes('FIN');
                            });

                            if (hasCourseHeader) hasCourse = true;
                            if (hasDateHeader) hasDate = true;
                            if (hasCourse && hasDate) break;
                        }
                    }

                    if (hasCourse && hasDate) {
                        selectedSheet = sheet;
                        rawRows = rows;
                        break;
                    }
                }

                // Fallback to first sheet if no match
                if (!selectedSheet && workbook.SheetNames.length > 0) {
                    selectedSheet = workbook.Sheets[workbook.SheetNames[0]];
                    if (selectedSheet['!ref']) {
                        const range = XLSX.utils.decode_range(selectedSheet['!ref']);
                        range.s.c = 0; // Force parse starting at Column A
                        rawRows = XLSX.utils.sheet_to_json(selectedSheet, { header: 1, range: range });
                    } else {
                        rawRows = XLSX.utils.sheet_to_json(selectedSheet, { header: 1 });
                    }
                }

                // Extract worker name from filename
                let workerName = file.name.replace(/\.[^/.]+$/, "").trim().toUpperCase();

                AppState.historyFiles[workerName] = rawRows;
                await saveKardexFile(workerName, file.name, rawRows);
                processed++;

                if (processed === total) {
                    statusTextHistory.textContent = `${Object.keys(AppState.historyFiles).length} trabajadores con Kardex cargados`;
                    statusDotHistory.classList.add('active');
                    showNotification(`Se cargaron y procesaron ${total} archivos de Kardex.`);

                    syncWorkersFromHistory();
                    checkInitState();

                    // Re-render courses if worker is currently selected
                    if (AppState.selectedWorker) {
                        selectWorker(AppState.selectedWorker, false);
                    }
                }
            } catch (err) {
                console.error(`Error al procesar archivo de Kardex ${file.name}:`, err);
                showNotification(`Error al procesar Kardex de ${file.name}: ${err.message}`, true);
            }
        };
        reader.readAsArrayBuffer(file);
    }
}

// Date Parser Helpers
function parseExcelDate(val) {
    if (!val) return null;
    if (val instanceof Date) return val;

    if (typeof val === 'number') {
        const excelEpoch = new Date(Date.UTC(1899, 11, 30));
        const msPerDay = 24 * 60 * 60 * 1000;
        return new Date(excelEpoch.getTime() + val * msPerDay + (12 * 60 * 60 * 1000));
    }

    if (typeof val === 'string') {
        val = val.trim();
        let parts = val.split(/[-/]/);
        if (parts.length === 3) {
            if (parts[2].length === 2 || parts[2].length === 4) {
                let day = parseInt(parts[0], 10);
                let month = parseInt(parts[1], 10) - 1;
                let year = parseInt(parts[2], 10);
                if (parts[2].length === 2) {
                    year += year < 50 ? 2000 : 1900;
                }
                return new Date(year, month, day);
            } else if (parts[0].length === 4) {
                let year = parseInt(parts[0], 10);
                let month = parseInt(parts[1], 10) - 1;
                let day = parseInt(parts[2], 10);
                return new Date(year, month, day);
            }
        }
        let parsedMs = Date.parse(val);
        if (!isNaN(parsedMs)) {
            return new Date(parsedMs);
        }
    }
    return null;
}

function formatDateSpanish(date) {
    if (!date) return '';
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
}

// Subtract days to compute Start Date, skipping Saturdays and Sundays
function calculateStartDate(endDate, durationHours) {
    let daysNeeded = Math.ceil(durationHours / 8);
    if (daysNeeded <= 0) daysNeeded = 1;
    let currentDate = new Date(endDate);
    let weekdaysCount = 0;

    while (weekdaysCount < daysNeeded) {
        let dayOfWeek = currentDate.getDay(); // 0: Sunday, 6: Saturday
        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
            weekdaysCount++;
        }
        if (weekdaysCount < daysNeeded) {
            currentDate.setDate(currentDate.getDate() - 1);
        }
    }
    return currentDate;
}

// Pick random weekday
function generateRandomWeekday(minYear = 2024, maxYear = 2026) {
    let start = new Date(minYear, 0, 1);
    let end = new Date(maxYear, 2, 24); // up to March 24
    let randDate;
    let day;
    do {
        randDate = new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
        day = randDate.getDay();
    } while (day === 0 || day === 6);
    return randDate;
}

// Occupation code and name extractors
function extractOccupationCode(puestoText) {
    if (!puestoText) return "464020200";
    const match = puestoText.match(/\d+/);
    return match ? match[0] : "464020200";
}

// Occupation code and name extractors
function extractOccupationName(puestoText) {
    if (!puestoText) return "";
    return puestoText.replace(/^[\d\s-]+/, "").trim();
}

// Render Workers List in Sidebar
function renderWorkerList() {
    const query = searchWorkerInput.value.toLowerCase().trim();
    const filterStatus = filterStatusSelect.value;

    workerListItemsContainer.innerHTML = '';

    const filtered = AppState.workers.filter(w => {
        const name = String(w.name || '').toUpperCase();
        const curp = String(w.curp || '').toLowerCase();
        const rpe = String(w.rpe || '').toLowerCase();

        // 1. Search Query filter
        const matchesQuery = name.toLowerCase().includes(query) || curp.includes(query) || rpe.includes(query);

        // 2. Letters Filter
        let matchesLetter = true;
        if (AppState.letterFilterEnabled) {
            const firstChar = name.trim().charAt(0);
            matchesLetter = AppState.activeLetters.has(firstChar);
        }

        // 3. Status Filter (localStorage lookup)
        let matchesStatus = true;
        const isCompleted = localStorage.getItem(`cfe_completed_${w.name}`) === 'true';
        if (filterStatus === 'completed') {
            matchesStatus = isCompleted;
        } else if (filterStatus === 'pending') {
            matchesStatus = !isCompleted;
        }

        return matchesQuery && matchesLetter && matchesStatus;
    });

    // Update worker count badge
    const badge = document.getElementById('worker-count-badge');
    if (badge) {
        if (filtered.length === AppState.workers.length) {
            badge.textContent = AppState.workers.length;
        } else {
            badge.textContent = `${filtered.length} / ${AppState.workers.length}`;
        }
    }

    if (filtered.length === 0) {
        workerListItemsContainer.innerHTML = `
            <div style="text-align: center; color: var(--text-muted); font-style: italic; padding: 20px 0; font-size:12px;">
                No se encontraron trabajadores con los filtros activos.
            </div>`;
        return;
    }

    filtered.forEach(w => {
        const isCompleted = localStorage.getItem(`cfe_completed_${w.name}`) === 'true';

        const item = document.createElement('div');
        item.className = 'worker-list-item';
        if (AppState.selectedWorker && AppState.selectedWorker.name === w.name) {
            item.classList.add('active');
        }

        item.innerHTML = `
            <div class="left-sec">
                <label class="checkbox-container" style="padding-left:18px;" onclick="event.stopPropagation()">
                    <input type="checkbox" ${isCompleted ? 'checked' : ''} onchange="toggleWorkerCompletedFromList('${w.name}', this.checked)">
                    <span class="checkmark" style="height:14px; width:14px; border-radius:3px;"></span>
                </label>
                <span class="worker-name-text" title="${w.name}">${w.name}</span>
            </div>
        `;

        item.addEventListener('click', (e) => {
            if (e.target.tagName !== 'INPUT' && !e.target.classList.contains('checkmark')) {
                selectWorker(w);
            }
        });

        workerListItemsContainer.appendChild(item);
    });
}

// Live Search Input Listener
searchWorkerInput.addEventListener('input', renderWorkerList);

// Selection callbacks from List
function toggleWorkerCompletedFromList(name, checked) {
    localStorage.setItem(`cfe_completed_${name}`, checked);
    if (AppState.selectedWorker && AppState.selectedWorker.name === name) {
        actWorkerCompletedCheckbox.checked = checked;
    }
    renderWorkerList();
}

function selectWorker(worker, resetSelection = true) {
    playSound('click');
    AppState.selectedWorker = worker;
    localStorage.setItem('cfe_last_selected_worker', worker.name);

    // Enable manual course button
    const manualBtn = document.getElementById('btn-add-manual-course');
    if (manualBtn) manualBtn.disabled = false;

    // Clear course search input
    const courseSearchInput = document.getElementById('search-courses-input');
    if (courseSearchInput) {
        courseSearchInput.value = '';
    }

    // Highlight active in sidebar list and autoscroll it
    document.querySelectorAll('.worker-list-item').forEach(item => {
        const nameEl = item.querySelector('.worker-name-text');
        if (nameEl && nameEl.textContent === worker.name) {
            item.classList.add('active');
            item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else {
            item.classList.remove('active');
        }
    });

    const wName = worker.name || '';
    const wCurp = worker.curp || '';
    const wCappa = worker.cappa || '';
    const wCappi = worker.cappi || '';
    const wRpe = worker.rpe || '--';

    actWorkerName.textContent = wName;
    actWorkerCurp.textContent = wCurp;
    actWorkerRpeBadge.textContent = `RPE: ${wRpe}`;
    actWorkerCappa.textContent = wCappa || 'Sin Puesto Asignado';
    actWorkerCappi.textContent = wCappi || 'Sin Puesto Asignado';

    // Load saved Number of Puesto or extract default
    const savedPuestoNum = localStorage.getItem(`cfe_puesto_num_${wName}`);
    if (savedPuestoNum) {
        actWorkerPuestoNum.value = savedPuestoNum;
    } else {
        actWorkerPuestoNum.value = extractOccupationCode(wCappa || wCappi);
    }

    // Validate worker data (CURP & Puesto)
    validateWorkerData(worker);

    // Load saved completed checkbox
    const savedCompleted = localStorage.getItem(`cfe_completed_${wName}`) === 'true';
    actWorkerCompletedCheckbox.checked = savedCompleted;

    // Gather required courses from CREDITOS and map their Kardex dates
    loadCoursesForSelectedWorker(resetSelection);

    // Render Live Preview with the first course
    if (AppState.workerCoursesList.length > 0) {
        if (resetSelection || activePreviewCourseId === null) {
            selectCourseForPreview(AppState.workerCoursesList[0]);
        } else {
            const current = AppState.workerCoursesList.find(c => c.id === activePreviewCourseId);
            if (current) selectCourseForPreview(current);
            else selectCourseForPreview(AppState.workerCoursesList[0]);
        }
    } else {
        updateLivePreview(wName, wCurp, null);
    }
}
    
function saveCourseState(workerName, course) {
    if (!workerName || !course) return;
    const cleanName = workerName.trim().toUpperCase();
    const cleanNameCourse = cleanCourseName(course.name);
    const stateKey = `cfe_course_state_${cleanName}_${cleanNameCourse}_${course.puestoType}`;
    const state = {
        endDate: course.endDate ? course.endDate.toISOString().split('T')[0] : null,
        instructorMode: course.instructorMode,
        manualInstructor: course.manualInstructor,
        selected: selectedCourseIds.has(course.id)
    };
    localStorage.setItem(stateKey, JSON.stringify(state));
}

function loadCoursesForSelectedWorker(resetSelection) {
    const worker = AppState.selectedWorker;
    const required = worker.requiredCourses || [];
    AppState.workerCoursesList = [];

    // Rebuild selectedCourseIds dynamically to avoid index mismatches
    selectedCourseIds.clear();

    // Grab history data (Kardex) for this worker
    const cleanName = worker.name.trim().toUpperCase();
    const normalizeStr = (str) => {
        if (!str) return '';
        return str.toString()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toUpperCase()
            .trim();
    };
    const normWorkerName = normalizeStr(cleanName);
    let historyData = AppState.historyFiles[cleanName];
    if (!historyData) {
        const key = Object.keys(AppState.historyFiles).find(k => {
            const normK = normalizeStr(k);
            return normK.includes(normWorkerName) || normWorkerName.includes(normK);
        });
        if (key) historyData = AppState.historyFiles[key];
    }

    // Map courseName in Kardex -> Date (with dynamic header scanning)
    const kardexCoursesMap = {};
    if (historyData) {
        // Find headers dynamically in the first 25 rows of Kardex
        let courseColIdx = 2; // Fallback to index 2 (Col C)
        let dateColIdx = 7;   // Fallback to index 7 (Col H)
        let headerRowIdx = -1;

        const cleanHeader = (val) => {
            return String(val || '')
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .toUpperCase()
                .trim();
        };

        for (let i = 0; i < Math.min(25, historyData.length); i++) {
            const row = historyData[i];
            if (row) {
                const hasCourseHeader = row.some(cell => {
                    const val = cleanHeader(cell);
                    return val.includes('CURSO') || val.includes('MATERIA') || val.includes('NOMBRE DEL CURSO');
                });
                const hasDateHeader = row.some(cell => {
                    const val = cleanHeader(cell);
                    return val.includes('FECHA') || (val.includes('ACREDITAC') && !val.includes('MODO')) || val.includes('TERMINO') || val.includes('FIN');
                });

                if (hasCourseHeader && hasDateHeader) {
                    headerRowIdx = i;
                    const cIdx = row.findIndex(h => {
                        const val = cleanHeader(h);
                        return val.includes('CURSO') || val.includes('MATERIA') || val.includes('NOMBRE DEL CURSO');
                    });
                    if (cIdx !== -1) courseColIdx = cIdx;

                    const dIdx = row.findIndex(h => {
                        const val = cleanHeader(h);
                        return val.includes('FECHA') || (val.includes('ACREDITAC') && !val.includes('MODO')) || val.includes('TERMINO') || val.includes('FIN');
                    });
                    if (dIdx !== -1) dateColIdx = dIdx;
                    break;
                }
            }
        }

        // If headers found, start iterating from row after header, else fallback to index 12 (row 13 in Excel)
        const startRow = headerRowIdx !== -1 ? headerRowIdx + 1 : 12;

        for (let r = startRow; r < historyData.length; r++) {
            const row = historyData[r];
            if (!row) continue;
            const rawCourse = row[courseColIdx];
            const rawDate = row[dateColIdx];
            if (rawCourse && rawDate) {
                const cleanCourse = cleanCourseName(String(rawCourse));
                const parsedDate = parseExcelDate(rawDate);
                if (cleanCourse && parsedDate) {
                    kardexCoursesMap[cleanCourse] = parsedDate;
                }
            }
        }
    }

    // Combine required courses (Excel) and manual courses (localStorage)
    const combined = [];
    required.forEach(c => {
        combined.push({
            name: c.name,
            hours: c.hours,
            area: c.area,
            puestoType: c.puestoType,
            isManual: false
        });
    });

    const manualKey = `cfe_manual_courses_${cleanName}`;
    const manualCourses = JSON.parse(localStorage.getItem(manualKey)) || [];
    manualCourses.forEach(c => {
        const isDup = combined.some(cc => cc.name.toUpperCase() === c.name.toUpperCase() && cc.puestoType === c.puestoType);
        if (!isDup) {
            combined.push({
                name: c.name,
                hours: c.hours,
                area: c.area || '2600-EDUCACION',
                puestoType: c.puestoType,
                isManual: true
            });
        }
    });

    combined.forEach((req, idx) => {
        const cleanReqName = cleanCourseName(req.name);
        let endDate = kardexCoursesMap[cleanReqName] || null;

        // Fuzzy matches check in Kardex
        if (!endDate) {
            const fuzzyKey = Object.keys(kardexCoursesMap).find(k => k.includes(cleanReqName) || cleanReqName.includes(k));
            if (fuzzyKey) endDate = kardexCoursesMap[fuzzyKey];
        }

        let startDate = endDate ? calculateStartDate(endDate, req.hours) : null;

        // Assign random instructor from list of 23
        let randInst = '';
        if (AppState.instructors.length > 0) {
            const randIdx = Math.floor(Math.random() * AppState.instructors.length);
            randInst = AppState.instructors[randIdx];
        }

        const courseObj = {
            id: idx,
            name: req.name,
            hours: req.hours,
            area: req.area,
            puestoType: req.puestoType,
            isManual: req.isManual,
            instructorMode: 'random', // 'random' or 'manual'
            randomInstructor: randInst,
            manualInstructor: randInst,
            endDate: endDate,
            startDate: startDate,
            manualDate: !endDate
        };

        // Apply saved custom state if exists
        const stateKey = `cfe_course_state_${cleanName}_${cleanReqName}_${req.puestoType}`;
        const savedStateStr = localStorage.getItem(stateKey);
        let shouldSelect = true; // Default selected for printing

        if (savedStateStr) {
            try {
                const savedState = JSON.parse(savedStateStr);
                if (savedState.instructorMode) courseObj.instructorMode = savedState.instructorMode;
                if (savedState.manualInstructor) {
                    if (AppState.instructors.includes(savedState.manualInstructor)) {
                        courseObj.manualInstructor = savedState.manualInstructor;
                    } else {
                        courseObj.instructorMode = 'random';
                    }
                }
                if (savedState.endDate !== undefined) {
                    if (savedState.endDate) {
                        courseObj.endDate = new Date(savedState.endDate);
                        courseObj.startDate = calculateStartDate(courseObj.endDate, courseObj.hours);
                        courseObj.manualDate = false;
                    } else {
                        courseObj.endDate = null;
                        courseObj.startDate = null;
                        courseObj.manualDate = true;
                    }
                }
                if (savedState.selected !== undefined) {
                    shouldSelect = savedState.selected;
                }
            } catch (e) {
                console.error("Error loading saved course state:", e);
            }
        }

        if (shouldSelect) {
            selectedCourseIds.add(idx);
        }

        AppState.workerCoursesList.push(courseObj);
    });

    renderCoursesTableForActiveWorker();
}

function renderCoursesTableForActiveWorker() {
    tableCoursesBody.innerHTML = '';

    if (AppState.workerCoursesList.length === 0) {
        tableCoursesBody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; color: var(--text-muted); font-style: italic; padding: 20px 0;">
                    Este trabajador no tiene cursos requeridos en las hojas CAPPA/CAPPI de CREDITOS.
                </td>
            </tr>`;
        btnGenerateSingle.disabled = true;
        return;
    }

    AppState.workerCoursesList.forEach(course => {
        const isSelected = selectedCourseIds.has(course.id);
        const isManual = course.manualDate;

        const tr = document.createElement('tr');
        tr.id = `course-row-${course.id}`;
        if (activePreviewCourseId === course.id) {
            tr.classList.add('active-row');
        }

        const endVal = course.endDate ? course.endDate.toISOString().split('T')[0] : '';
        const startVal = course.startDate ? course.startDate.toISOString().split('T')[0] : '';

        let instOptionsHtml = `<option value="random" ${course.instructorMode === 'random' ? 'selected' : ''}>Aleatorio (${course.randomInstructor})</option>`;
        AppState.instructors.forEach(inst => {
            const isSel = course.instructorMode === 'manual' && course.manualInstructor === inst;
            instOptionsHtml += `<option value="${inst}" ${isSel ? 'selected' : ''}>${inst}</option>`;
        });

        let nameCellHtml = course.name;
        if (course.isManual) {
            nameCellHtml = `
                <span style="display:inline-flex; align-items:center; gap:6px; flex-wrap:nowrap;">
                    ${course.name}
                    <button onclick="event.stopPropagation(); deleteManualCourse('${course.name}', '${course.puestoType}')" class="btn btn-secondary" style="padding: 2px 4px; min-height: unset; background: rgba(248, 113, 113, 0.1); border-color: rgba(248, 113, 113, 0.2); color: #fca5a5; display: inline-flex;" title="Eliminar Curso Manual">
                        <svg viewBox="0 0 24 24" style="width: 10px; height: 10px; fill: currentColor;">
                            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                        </svg>
                    </button>
                </span>
            `;
        }

        tr.innerHTML = `
            <td style="text-align:center;">
                <label class="checkbox-container" style="padding-left:18px; display:inline-block;">
                    <input type="checkbox" ${isSelected ? 'checked' : ''} onchange="toggleCourseSelection(${course.id}, this.checked)">
                    <span class="checkmark" style="height:14px; width:14px; border-radius:3px;"></span>
                </label>
            </td>
            <td style="font-weight:600; font-size:13px;" class="course-cell-click">${nameCellHtml}</td>
            <td class="course-cell-click"><span class="badge ${course.puestoType === 'CAPPA' ? 'badge-cappa' : 'badge-cappi'}" style="font-size:10px; padding:3px 8px;">${course.puestoType}</span></td>
            <td style="text-align: center; font-weight:700; color:var(--secondary); font-size:13px;" class="course-cell-click">${course.hours}h</td>
            <td>
                <select class="input-control" style="padding: 5px 8px; font-size:12px;" onchange="updateCourseInstructorMode(${course.id}, this.value)">
                    ${instOptionsHtml}
                </select>
            </td>
            <td>
                <div style="display:flex; align-items:center; gap:4px;">
                    <input type="date" class="input-control" style="padding: 5px 8px; font-size:12px; width:115px; border-color:${(!course.endDate) ? 'var(--danger)' : 'var(--glass-border)'}" value="${endVal}" onchange="updateCourseEndDate(${course.id}, this.value)">
                    <button onclick="triggerSingleRandomDate(${course.id})" class="btn btn-secondary" style="padding:6px 8px; font-size:11px; display:inline-flex; align-items:center; justify-content:center;" title="Fecha Aleatoria">
                        <svg viewBox="0 0 24 24" style="width: 11px; height: 11px; fill: currentColor;">
                            <path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/>
                        </svg>
                    </button>
                </div>
            </td>
            <td>
                <input type="date" class="input-control" style="padding: 5px 8px; font-size:12px; width:110px; background:rgba(0,0,0,0.2)" value="${startVal}" readonly>
            </td>
        `;

        // Live preview triggers when clicking on text cells
        tr.querySelectorAll('.course-cell-click').forEach(cell => {
            cell.addEventListener('click', () => {
                selectCourseForPreview(course);
            });
        });

        tableCoursesBody.appendChild(tr);
    });

    updateSelectedCount();
}

// Filter courses table dynamically based on search input
function filterCoursesTable() {
    const query = document.getElementById('search-courses-input').value.toLowerCase().trim();
    const rows = document.querySelectorAll('#table-courses-dashboard-body tr');

    rows.forEach(row => {
        // Skip if it is the default empty row (with colspan=7)
        if (row.cells.length === 1 && row.cells[0].colSpan === 7) return;

        const courseCell = row.querySelector('.course-cell-click');
        if (courseCell) {
            const name = courseCell.textContent.toLowerCase();
            if (name.includes(query)) {
                row.style.display = '';
            } else {
                row.style.display = 'none';
            }
        }
    });
}

// Selection checkbox triggers
function toggleCourseSelection(id, checked) {
    if (checked) {
        selectedCourseIds.add(id);
    } else {
        selectedCourseIds.delete(id);
    }
    const course = AppState.workerCoursesList.find(c => c.id === id);
    if (course && AppState.selectedWorker) {
        saveCourseState(AppState.selectedWorker.name, course);
    }
    updateSelectedCount();
}

function updateSelectedCount() {
    const count = selectedCourseIds.size;
    selectedCoursesCountEl.textContent = count;
    btnGenerateSingle.disabled = count === 0;
}

// Row inputs changes
function updateCourseInstructorMode(id, val) {
    const course = AppState.workerCoursesList.find(c => c.id === id);
    if (course) {
        if (val === 'random') {
            course.instructorMode = 'random';
        } else {
            course.instructorMode = 'manual';
            course.manualInstructor = val;
        }
        if (AppState.selectedWorker) {
            saveCourseState(AppState.selectedWorker.name, course);
        }
        if (activePreviewCourseId === id) {
            selectCourseForPreview(course);
        }
    }
}

function updateCourseEndDate(id, val) {
    const course = AppState.workerCoursesList.find(c => c.id === id);
    if (course) {
        if (val) {
            course.endDate = new Date(val);
            course.startDate = calculateStartDate(course.endDate, course.hours);
            course.manualDate = false;
        } else {
            course.endDate = null;
            course.startDate = null;
            course.manualDate = true;
        }

        if (AppState.selectedWorker) {
            saveCourseState(AppState.selectedWorker.name, course);
        }

        // Re-render row dates
        const row = document.getElementById(`course-row-${id}`);
        if (row) {
            const startInput = row.querySelectorAll('input[type="date"]')[1];
            const endInput = row.querySelectorAll('input[type="date"]')[0];
            startInput.value = course.startDate ? course.startDate.toISOString().split('T')[0] : '';
            endInput.style.borderColor = course.endDate ? 'var(--glass-border)' : 'var(--danger)';
        }

        if (activePreviewCourseId === id) {
            selectCourseForPreview(course);
        }
    }
}

// Trigger single random date button
function triggerSingleRandomDate(id) {
    const course = AppState.workerCoursesList.find(c => c.id === id);
    if (course) {
        const minYear = parseInt(document.getElementById('config-rand-min-year').value) || 2024;
        const maxYear = parseInt(document.getElementById('config-rand-max-year').value) || 2026;
        const randDate = generateRandomWeekday(minYear, maxYear);

        course.endDate = randDate;
        course.startDate = calculateStartDate(randDate, course.hours);
        course.manualDate = true;

        if (AppState.selectedWorker) {
            saveCourseState(AppState.selectedWorker.name, course);
        }

        const row = document.getElementById(`course-row-${id}`);
        if (row) {
            const endInput = row.querySelectorAll('input[type="date"]')[0];
            const startInput = row.querySelectorAll('input[type="date"]')[1];
            endInput.value = randDate.toISOString().split('T')[0];
            startInput.value = course.startDate.toISOString().split('T')[0];
            endInput.style.borderColor = 'var(--glass-border)';
        }

        playSound('click');
        if (activePreviewCourseId === id) {
            selectCourseForPreview(course);
        }
    }
}

// Bulk action to assign random dates
function generateRandomDatesForEmptyCourses() {
    if (!AppState.selectedWorker || AppState.workerCoursesList.length === 0) return;

    const minYear = parseInt(document.getElementById('config-rand-min-year').value) || 2024;
    const maxYear = parseInt(document.getElementById('config-rand-max-year').value) || 2026;

    let updated = 0;
    AppState.workerCoursesList.forEach(course => {
        if (!course.endDate) {
            const randDate = generateRandomWeekday(minYear, maxYear);
            course.endDate = randDate;
            course.startDate = calculateStartDate(randDate, course.hours);
            course.manualDate = true;
            if (AppState.selectedWorker) {
                saveCourseState(AppState.selectedWorker.name, course);
            }
            updated++;
        }
    });

    if (updated > 0) {
        playSound('success');
        showNotification(`Se asignaron ${updated} fechas aleatorias en días hábiles (lunes a viernes).`);
        renderCoursesTableForActiveWorker();
        if (activePreviewCourseId !== null) {
            const current = AppState.workerCoursesList.find(c => c.id === activePreviewCourseId);
            if (current) selectCourseForPreview(current);
        }
    } else {
        showNotification("Todos los cursos ya cuentan con fechas de término.", false);
    }
}

// LocalStorage active worker bindings
function toggleWorkerCompletedStatus() {
    if (AppState.selectedWorker) {
        const checked = actWorkerCompletedCheckbox.checked;
        localStorage.setItem(`cfe_completed_${AppState.selectedWorker.name}`, checked);
        renderWorkerList();
    }
}

// Bind active worker Puesto Number changes
actWorkerPuestoNum.addEventListener('input', () => {
    if (AppState.selectedWorker) {
        const val = actWorkerPuestoNum.value.trim();
        localStorage.setItem(`cfe_puesto_num_${AppState.selectedWorker.name}`, val);

        // Validate puesto input
        validatePuestoNumInput(val);

        // Update live preview
        if (activePreviewCourseId !== null && AppState.workerCoursesList.length > 0) {
            const current = AppState.workerCoursesList.find(c => c.id === activePreviewCourseId);
            if (current) selectCourseForPreview(current);
        }
    }
});

// Set course preview row
function selectCourseForPreview(course) {
    activePreviewCourseId = course.id;

    // Highlight row
    document.querySelectorAll('#table-courses-dashboard tbody tr').forEach(tr => {
        if (tr.id === `course-row-${course.id}`) {
            tr.classList.add('active-row');
        } else {
            tr.classList.remove('active-row');
        }
    });

    const wName = AppState.selectedWorker.name || '';
    const wCurp = AppState.selectedWorker.curp || '';

    updateLivePreview(wName, wCurp, course);
}

// Update Live Preview fields
function updateLivePreview(wName, wCurp, course) {
    document.getElementById('prev-worker-name').textContent = formatSurnamesFirst(wName) || '--';
    document.getElementById('prev-sig-worker-bottom').textContent = formatSurnamesFirst(wName) || '--';

    // CURP boxes
    const curpBoxesContainer = document.getElementById('prev-curp-boxes');
    curpBoxesContainer.innerHTML = '';
    const cleanCurp = (wCurp || '').toUpperCase();
    for (let i = 0; i < 18; i++) {
        const box = document.createElement('div');
        box.className = 'dc3-box';
        box.textContent = cleanCurp[i] || '';
        curpBoxesContainer.appendChild(box);
    }

    // Positions & Occupation
    const cappaVal = AppState.selectedWorker ? (AppState.selectedWorker.cappa || '') : '';
    const cappiVal = AppState.selectedWorker ? (AppState.selectedWorker.cappi || '') : '';
    const puestoNum = actWorkerPuestoNum.value.trim() || extractOccupationCode(cappaVal || cappiVal);

    let displayPuesto = '--';
    if (course) {
        displayPuesto = course.puestoType === 'CAPPA' ? extractOccupationName(cappaVal) : extractOccupationName(cappiVal);
        document.getElementById('preview-course-type').textContent = course.puestoType;
        document.getElementById('preview-course-type').className = `badge ${course.puestoType === 'CAPPA' ? 'badge-cappa' : 'badge-cappi'}`;
    } else {
        displayPuesto = extractOccupationName(cappaVal);
        document.getElementById('preview-course-type').textContent = '--';
        document.getElementById('preview-course-type').className = 'badge';
    }

    document.getElementById('prev-puesto').textContent = displayPuesto || '--';
    document.getElementById('prev-occupation').textContent = `${puestoNum} - ${displayPuesto || '--'}`;

    // Static signatures config
    const patronRep = document.getElementById('config-patron-rep').value;
    const workerRep = document.getElementById('config-worker-rep').value;
    document.getElementById('prev-sig-patron').textContent = patronRep || '--';
    document.getElementById('prev-sig-work').textContent = workerRep || '--';
    document.getElementById('prev-company-name').textContent = document.getElementById('config-company').value || '--';

    let activeInstructor = '';
    if (course) {
        activeInstructor = course.instructorMode === 'random' ? course.randomInstructor : course.manualInstructor;
        document.getElementById('prev-course-name').textContent = course.name;
        document.getElementById('prev-course-hours').textContent = `${course.hours} horas`;
        document.getElementById('prev-course-area').textContent = course.area;
        document.getElementById('prev-course-instructor').textContent = activeInstructor || '--';
        document.getElementById('prev-sig-instructor').textContent = activeInstructor || '--';

        fillDateBoxes('prev-start-date-boxes', course.startDate);
        fillDateBoxes('prev-end-date-boxes', course.endDate);

        // Toggle legend visibility
        const legendEl = document.getElementById('prev-legend-container');
        if (course.endDate && course.endDate.getFullYear() <= 2021) {
            legendEl.style.display = 'block';
        } else {
            legendEl.style.display = 'none';
        }
    } else {
        document.getElementById('prev-course-name').textContent = '--';
        document.getElementById('prev-course-hours').textContent = '--';
        document.getElementById('prev-course-area').textContent = '--';
        document.getElementById('prev-course-instructor').textContent = '--';
        document.getElementById('prev-sig-instructor').textContent = '--';
        clearDateBoxes('prev-start-date-boxes');
        clearDateBoxes('prev-end-date-boxes');
        document.getElementById('prev-legend-container').style.display = 'none';
    }

    // Render digital signature image overlays
    const courseDate = course ? course.endDate : null;
    const isPatronValid = isSignatureValidForCourseYear('patron', courseDate);
    const isWorkerValid = isSignatureValidForCourseYear('worker', courseDate);

    renderSigImageOverlay('prev-sig-instructor-img', activeInstructor, true);
    renderSigImageOverlay('prev-sig-patron-img', patronRep, isPatronValid);
    renderSigImageOverlay('prev-sig-work-img', workerRep, isWorkerValid);
    renderSigImageOverlay('prev-sig-worker-bottom-img', wName, true);
}

function fillDateBoxes(containerId, date) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    if (!date) return;

    const yyyy = String(date.getFullYear());
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');

    for (let i = 0; i < 4; i++) {
        const box = document.createElement('div');
        box.className = 'dc3-box';
        box.textContent = yyyy[i] || '';
        container.appendChild(box);
    }
    const spacer1 = document.createElement('div');
    spacer1.className = 'dc3-box spacer';
    spacer1.textContent = '/';
    container.appendChild(spacer1);

    for (let i = 0; i < 2; i++) {
        const box = document.createElement('div');
        box.className = 'dc3-box';
        box.textContent = mm[i] || '';
        container.appendChild(box);
    }
    const spacer2 = document.createElement('div');
    spacer2.className = 'dc3-box spacer';
    spacer2.textContent = '/';
    container.appendChild(spacer2);

    for (let i = 0; i < 2; i++) {
        const box = document.createElement('div');
        box.className = 'dc3-box';
        box.textContent = dd[i] || '';
        container.appendChild(box);
    }
}

function clearDateBoxes(containerId) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    for (let i = 0; i < 4; i++) {
        container.appendChild(document.createElement('div')).className = 'dc3-box';
    }
    container.appendChild(document.createElement('div')).className = 'dc3-box spacer';
    for (let i = 0; i < 2; i++) {
        container.appendChild(document.createElement('div')).className = 'dc3-box';
    }
    container.appendChild(document.createElement('div')).className = 'dc3-box spacer';
    for (let i = 0; i < 2; i++) {
        container.appendChild(document.createElement('div')).className = 'dc3-box';
    }
}

// Map course variables to template contexts
function buildCourseContext(course) {
    const worker = AppState.selectedWorker;
    const wName = worker.name || '';
    const wCurp = worker.curp || '';
    const wCappa = worker.cappa || '';
    const wCappi = worker.cappi || '';

    const patronRep = document.getElementById('config-patron-rep').value || localStorage.getItem('cfe_patron_rep') || "JOSE DAVID LOPEZ MEDINA";
    const workerRep = document.getElementById('config-worker-rep').value || localStorage.getItem('cfe_worker_rep') || "JUAN CARLOS SERNA GOMEZ";
    const companyName = document.getElementById('config-company').value || localStorage.getItem('cfe_company') || "COMISIÓN FEDERAL DE ELECTRICIDAD";

    const puestoNum = actWorkerPuestoNum.value.trim() || extractOccupationCode(wCappa || wCappi);
    const displayPuesto = course.puestoType === 'CAPPA' ? extractOccupationName(wCappa) : extractOccupationName(wCappi);

    const activeInstructor = course.instructorMode === 'random' ? course.randomInstructor : course.manualInstructor;
    const hasLegend = course.endDate && course.endDate.getFullYear() <= 2021;

    const courseCtx = {
        NOMBRE: formatSurnamesFirst(wName).toUpperCase(),
        PUESTO: displayPuesto.toUpperCase(),
        NUMEROPUESTO: puestoNum,
        CURSO: course.name.toUpperCase(),
        DURACION: String(course.hours),
        INSTRUCTOR: activeInstructor.toUpperCase(),

        nombre: formatSurnamesFirst(wName).toUpperCase(),
        puesto: displayPuesto.toUpperCase(),
        curso: course.name.toUpperCase(),
        duracion: String(course.hours),
        instructor: activeInstructor.toUpperCase(),
        patron_rep: patronRep.toUpperCase(),
        worker_rep: workerRep.toUpperCase(),
        razon_social: companyName.toUpperCase(),
        PATRON: patronRep.toUpperCase(),
        REPRESENTANTE: workerRep.toUpperCase(),
        PATRON_REP: patronRep.toUpperCase(),
        WORKER_REP: workerRep.toUpperCase(),
        RAZON_SOCIAL: companyName.toUpperCase(),
        REPRESENTANTE_PATRON: patronRep.toUpperCase(),
        REPRESENTANTE_TRABAJADOR: workerRep.toUpperCase(),
        REPRESENTANTE_TRABAJADORES: workerRep.toUpperCase(),
        EMPRESA: companyName.toUpperCase(),
        fecha_inicio: formatDateSpanish(course.startDate),
        fecha_fin: formatDateSpanish(course.endDate),
        hasLegend: hasLegend
    };

    // CURP split
    const curpUpper = wCurp.toUpperCase();
    for (let i = 1; i <= 18; i++) {
        courseCtx[`CURP${i}`] = curpUpper[i - 1] || '';
        courseCtx[`c${i - 1}`] = curpUpper[i - 1] || '';
    }

    // Start Date split
    const sy = String(course.startDate.getFullYear());
    const sm = String(course.startDate.getMonth() + 1).padStart(2, '0');
    const sd = String(course.startDate.getDate()).padStart(2, '0');
    courseCtx['AÑO1'] = sy[0] || '';
    courseCtx['AÑO2'] = sy[1] || '';
    courseCtx['AÑO3'] = sy[2] || '';
    courseCtx['AÑO4'] = sy[3] || '';
    courseCtx['MES1'] = sm[0] || '';
    courseCtx['MES2'] = sm[1] || '';
    courseCtx['DIA1'] = sd[0] || '';
    courseCtx['DIA2'] = sd[1] || '';

    courseCtx['sy0'] = sy[0] || ''; courseCtx['sy1'] = sy[1] || ''; courseCtx['sy2'] = sy[2] || ''; courseCtx['sy3'] = sy[3] || '';
    courseCtx['sm0'] = sm[0] || ''; courseCtx['sm1'] = sm[1] || '';
    courseCtx['sd0'] = sd[0] || ''; courseCtx['sd1'] = sd[1] || '';

    // End Date split
    const ey = String(course.endDate.getFullYear());
    const em = String(course.endDate.getMonth() + 1).padStart(2, '0');
    const ed = String(course.endDate.getDate()).padStart(2, '0');
    courseCtx['AÑO5'] = ey[0] || '';
    courseCtx['AÑO6'] = ey[1] || '';
    courseCtx['AÑO7'] = ey[2] || '';
    courseCtx['AÑO8'] = ey[3] || '';
    courseCtx['MES3'] = em[0] || '';
    courseCtx['MES4'] = em[1] || '';
    courseCtx['DIA3'] = ed[0] || '';
    courseCtx['DIA4'] = ed[1] || '';

    courseCtx['ey0'] = ey[0] || ''; courseCtx['ey1'] = ey[1] || ''; courseCtx['ey2'] = ey[2] || ''; courseCtx['ey3'] = ey[3] || '';
    courseCtx['em0'] = em[0] || ''; courseCtx['em1'] = em[1] || '';
    courseCtx['ed0'] = ed[0] || ''; courseCtx['ed1'] = ed[1] || '';

    return courseCtx;
}

// GENERATE MERGED SINGLE DOCUMENT FOR ALL SELECTED COURSES (Print-ready)
async function generateMergedDocument() {
    if (!AppState.templateFile || !AppState.selectedWorker) {
        showNotification("Faltan datos requeridos o plantilla.", true);
        return;
    }

    const selected = AppState.workerCoursesList.filter(c => selectedCourseIds.has(c.id));
    const hasEmptyDates = selected.some(c => !c.endDate);
    if (hasEmptyDates) {
        showNotification("Todos los cursos seleccionados deben tener fechas asignadas.", true);
        return;
    }

    playSound('generate');

    try {
        // Programmatic wrapping of template XML for looping
        const zipContent = preprocessTemplateXml(AppState.templateFile);
        let docXml = zipContent.files["word/document.xml"].asText();

        const bodyStart = docXml.indexOf("<w:body>");
        const bodyEnd = docXml.lastIndexOf("</w:body>");
        if (bodyStart === -1 || bodyEnd === -1) throw new Error("Etiqueta <w:body> no encontrada.");

        const header = docXml.substring(0, bodyStart + 8);
        const bodyContent = docXml.substring(bodyStart + 8, bodyEnd);
        const footer = docXml.substring(bodyEnd);

        // Isolate document section settings so layout isn't duplicated incorrectly
        const sectPrStart = bodyContent.lastIndexOf("<w:sectPr");
        let wrappedBodyContent = "";

        const loopStart = '<w:p><w:pPr><w:keepNext w:val="false"/></w:pPr><w:r><w:t>«#CURSOS»</w:t></w:r></w:p>';
        const pageBreakAndLoopEnd = '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr></w:pPr><w:r><w:t>«^isLast»</w:t></w:r><w:r><w:br w:type="page"/></w:r><w:r><w:t>«/isLast»</w:t></w:r></w:p><w:p><w:r><w:t>«/CURSOS»</w:t></w:r></w:p>';

        if (sectPrStart !== -1) {
            const sectPrEnd = bodyContent.indexOf("</w:sectPr>", sectPrStart);
            if (sectPrEnd !== -1) {
                const sectPr = bodyContent.substring(sectPrStart, sectPrEnd + 11);
                const mainContent = bodyContent.substring(0, sectPrStart);
                const afterSectPr = bodyContent.substring(sectPrEnd + 11);

                wrappedBodyContent = loopStart + mainContent + pageBreakAndLoopEnd + sectPr + afterSectPr;
            } else {
                wrappedBodyContent = loopStart + bodyContent + pageBreakAndLoopEnd;
            }
        } else {
            wrappedBodyContent = loopStart + bodyContent + pageBreakAndLoopEnd;
        }

        docXml = header + wrappedBodyContent + footer;
        zipContent.file("word/document.xml", docXml);

        // Construct data mapping array
        const mappingArray = selected.map((c, idx) => {
            const ctx = buildCourseContext(c);
            ctx.isLast = (idx === selected.length - 1);
            return ctx;
        });
        const templateData = {
            CURSOS: mappingArray
        };

        const doc = createDocxtemplaterInstance(zipContent);

        doc.setData(templateData);
        doc.render();

        const out = doc.getZip().generate({
            type: "blob",
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        });

        const wName = AppState.selectedWorker.name || 'CFE';
        saveAs(out, `${wName.toUpperCase()}.docx`);
        showNotification(`Se generó el documento único con ${selected.length} constancias DC-3.`);
    } catch (err) {
        showNotification(`Error al generar documento único: ${err.message}`, true);
        console.error(err);
    }
}

// GENERATE ZIP PACKAGE WITH SEPARATE DOCUMENTS
async function generateSeparateZipDocuments() {
    if (!AppState.templateFile || !AppState.selectedWorker) {
        showNotification("Faltan datos requeridos o plantilla.", true);
        return;
    }

    const selected = AppState.workerCoursesList.filter(c => selectedCourseIds.has(c.id));
    const hasEmptyDates = selected.some(c => !c.endDate);
    if (hasEmptyDates) {
        showNotification("Todos los cursos seleccionados deben tener fechas asignadas.", true);
        return;
    }

    playSound('generate');
    const zip = new JSZip();
    const wName = AppState.selectedWorker.name || 'CFE';

    try {
        for (const course of selected) {
            const zipContent = preprocessTemplateXml(AppState.templateFile);
            const doc = createDocxtemplaterInstance(zipContent);

            const dataCtx = buildCourseContext(course);
            doc.setData(dataCtx);
            doc.render();

            const out = doc.getZip().generate({
                type: "blob",
                mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            });

            const cleanCourseName = course.name.replace(/[/\\?%*:|"<>]/g, '-');
            zip.file(`DC-3 - ${wName.toUpperCase()} - ${cleanCourseName.toUpperCase()}.docx`, out);
        }

        if (selected.length === 1) {
            const singleDoc = await zip.file(Object.keys(zip.files)[0]).async("blob");
            saveAs(singleDoc, Object.keys(zip.files)[0]);
            showNotification(`Se generó 1 constancia correctamente.`);
        } else {
            const content = await zip.generateAsync({ type: "blob" });
            saveAs(content, `CONSTANCIAS DC-3 - ${wName.toUpperCase()}.zip`);
            showNotification(`Se descargaron ${selected.length} constancias en un paquete ZIP.`);
        }
    } catch (err) {
        showNotification(`Error al generar ZIP: ${err.message}`, true);
        console.error(err);
    }
}

// GENERATE PDF BY TEMPORARILY RENDERING AND TRIGGERING PRINT
function printSelectedCoursesAsPDF() {
    if (!AppState.selectedWorker) {
        showNotification("Selecciona un trabajador primero.", true);
        return;
    }

    const selected = AppState.workerCoursesList.filter(c => selectedCourseIds.has(c.id));
    if (selected.length === 0) {
        showNotification("No hay cursos seleccionados para imprimir.", true);
        return;
    }

    const hasEmptyDates = selected.some(c => !c.endDate);
    if (hasEmptyDates) {
        showNotification("Todos los cursos seleccionados deben tener fechas asignadas.", true);
        return;
    }

    playSound('generate');

    const wName = AppState.selectedWorker.name || '';
    const wCurp = AppState.selectedWorker.curp || '';
    const cappaVal = AppState.selectedWorker.cappa || '';
    const cappiVal = AppState.selectedWorker.cappi || '';
    const puestoNum = actWorkerPuestoNum.value.trim() || extractOccupationCode(cappaVal || cappiVal);

    const patronRep = document.getElementById('config-patron-rep').value;
    const workerRep = document.getElementById('config-worker-rep').value;
    const companyName = document.getElementById('config-company').value;

    const printSection = document.getElementById('print-section');
    printSection.innerHTML = '';

    selected.forEach(course => {
        const formattedWorkerName = formatSurnamesFirst(wName).toUpperCase();
        const displayPuesto = course.puestoType === 'CAPPA' ? extractOccupationName(cappaVal) : extractOccupationName(cappiVal);
        const activeInstructor = course.instructorMode === 'random' ? course.randomInstructor : course.manualInstructor;
        const hasLegend = course.endDate && course.endDate.getFullYear() <= 2021;

        // Evaluar año de inicio para representantes
        const isPatronValid = isSignatureValidForCourseYear('patron', course.endDate);
        const isWorkerValid = isSignatureValidForCourseYear('worker', course.endDate);

        // Buscar imágenes de firmas correspondientes según año de inicio
        const sigInstUrl = findSignatureForName(activeInstructor);
        const sigPatronUrl = isPatronValid ? findSignatureForName(patronRep) : null;
        const sigWorkerRepUrl = isWorkerValid ? findSignatureForName(workerRep) : null;
        const sigWorkerUrl = findSignatureForName(wName);

        // CURP boxes
        let curpBoxesHtml = '';
        const cleanCurp = wCurp.toUpperCase();
        for (let i = 0; i < 18; i++) {
            curpBoxesHtml += `<div class="dc3-box">${cleanCurp[i] || ''}</div>`;
        }

        // RFC boxes (CFE default RFC)
        const rfcBoxesHtml = `
            <div class="dc3-box">C</div>
            <div class="dc3-box">F</div>
            <div class="dc3-box">E</div>
            <div class="dc3-box spacer">-</div>
            <div class="dc3-box">3</div>
            <div class="dc3-box">7</div>
            <div class="dc3-box">0</div>
            <div class="dc3-box">8</div>
            <div class="dc3-box">1</div>
            <div class="dc3-box">4</div>
            <div class="dc3-box spacer">-</div>
            <div class="dc3-box">Q</div>
            <div class="dc3-box">I</div>
            <div class="dc3-box">0</div>
        `;

        // Start date boxes
        let startDateBoxesHtml = '';
        if (course.startDate) {
            const sy = String(course.startDate.getFullYear());
            const sm = String(course.startDate.getMonth() + 1).padStart(2, '0');
            const sd = String(course.startDate.getDate()).padStart(2, '0');
            for (let i = 0; i < 4; i++) startDateBoxesHtml += `<div class="dc3-box">${sy[i] || ''}</div>`;
            startDateBoxesHtml += `<div class="dc3-box spacer">/</div>`;
            for (let i = 0; i < 2; i++) startDateBoxesHtml += `<div class="dc3-box">${sm[i] || ''}</div>`;
            startDateBoxesHtml += `<div class="dc3-box spacer">/</div>`;
            for (let i = 0; i < 2; i++) startDateBoxesHtml += `<div class="dc3-box">${sd[i] || ''}</div>`;
        }

        // End date boxes
        let endDateBoxesHtml = '';
        if (course.endDate) {
            const ey = String(course.endDate.getFullYear());
            const em = String(course.endDate.getMonth() + 1).padStart(2, '0');
            const ed = String(course.endDate.getDate()).padStart(2, '0');
            for (let i = 0; i < 4; i++) endDateBoxesHtml += `<div class="dc3-box">${ey[i] || ''}</div>`;
            endDateBoxesHtml += `<div class="dc3-box spacer">/</div>`;
            for (let i = 0; i < 2; i++) endDateBoxesHtml += `<div class="dc3-box">${em[i] || ''}</div>`;
            endDateBoxesHtml += `<div class="dc3-box spacer">/</div>`;
            for (let i = 0; i < 2; i++) endDateBoxesHtml += `<div class="dc3-box">${ed[i] || ''}</div>`;
        }

        const legendHtml = hasLegend ? `
            <div style="text-align: justify; font-size: 8px; margin-top: 6px; font-style: italic; border-top: 1px dashed rgba(0,0,0,0.15); padding-top: 4px; line-height: 1.2; color: #000;">
                Dando seguimiento a la supervisión nacional se identificó que hay CCHL en años anteriores al 2024 que no están impresas por lo que se estarán regularizando con el nombre de la autoridades actuales para contar con el expediente completo atentamente Lic. Ivonne Reza Rugerio jefa de oficina de capacitación en funciones
            </div>
        ` : '';

        const pageHtml = `
            <div class="dc3-page print-page">
                <h2>FORMATO DC-3</h2>
                <h3>CONSTANCIA DE COMPETENCIAS O DE HABILIDADES LABORALES</h3>
 
                <!-- Datos del Trabajador -->
                <div class="dc3-section">
                    <div class="dc3-section-title">DATOS DEL TRABAJADOR</div>
                    <div class="dc3-row">
                        <div class="dc3-label">Nombre (Anotar apellido paterno, materno y nombre (s))</div>
                        <div class="dc3-val">${formattedWorkerName}</div>
                    </div>
                    <div class="dc3-columns-grid">
                        <div>
                            <div class="dc3-label">Clave Única de Registro de Población (CURP)</div>
                            <div class="dc3-boxes">${curpBoxesHtml}</div>
                        </div>
                        <div>
                            <div class="dc3-label">Ocupación específica (Catálogo Nacional)</div>
                            <div class="dc3-val" style="font-size: 7.5px; line-height: 1;">${puestoNum} - ${displayPuesto || '--'}</div>
                        </div>
                    </div>
                    <div class="dc3-row">
                        <div class="dc3-label">Puesto</div>
                        <div class="dc3-val">${displayPuesto || '--'}</div>
                    </div>
                </div>
 
                <!-- Datos de la Empresa -->
                <div class="dc3-section">
                    <div class="dc3-section-title">DATOS DE LA EMPRESA</div>
                    <div class="dc3-row">
                        <div class="dc3-label">Nombre o Razón Social</div>
                        <div class="dc3-val">${companyName || '--'}</div>
                    </div>
                    <div class="dc3-row">
                        <div class="dc3-label">Registro Federal de Contribuyentes con homoclave (RFC)</div>
                        <div class="dc3-boxes">${rfcBoxesHtml}</div>
                    </div>
                </div>
 
                <!-- Datos del Programa de Capacitación -->
                <div class="dc3-section">
                    <div class="dc3-section-title">DATOS DEL PROGRAMA DE CAPACITACIÓN</div>
                    <div class="dc3-row">
                        <div class="dc3-label">Nombre del curso</div>
                        <div class="dc3-val" style="font-weight:800; line-height:1;">${course.name}</div>
                    </div>
                    <div class="dc3-columns-grid" style="grid-template-columns: 0.8fr 2fr;">
                        <div>
                            <div class="dc3-label">Duración en horas</div>
                            <div class="dc3-val">${course.hours} horas</div>
                        </div>
                        <div>
                            <div class="dc3-label">Periodo de ejecución: De (Año/Mes/Día) a (Año/Mes/Día)</div>
                            <div style="display: flex; align-items: center; gap: 4px; margin-top:2px;">
                                <div class="dc3-label" style="font-size: 6px;">De:</div>
                                <div class="dc3-boxes">${startDateBoxesHtml}</div>
                                <div class="dc3-label" style="font-size: 6px; margin-left: 2px;">A:</div>
                                <div class="dc3-boxes">${endDateBoxesHtml}</div>
                            </div>
                        </div>
                    </div>
                    <div class="dc3-row">
                        <div class="dc3-label">Área temática del curso</div>
                        <div class="dc3-val">${course.area}</div>
                    </div>
                    <div class="dc3-row">
                        <div class="dc3-label">Nombre del agente capacitador o STPS</div>
                        <div class="dc3-val">${activeInstructor || '--'}</div>
                    </div>
                </div>
 
                <!-- Signatures Mockup -->
                <div class="dc3-signatures">
                    <div class="dc3-sig-box">
                        ${sigInstUrl ? `<div class="dc3-sig-img-container"><img src="${sigInstUrl}" class="dc3-sig-img" alt="Firma"></div>` : ''}
                        <div class="dc3-sig-val">${activeInstructor || '--'}</div>
                        <div class="dc3-sig-line">Instructor o Tutor</div>
                    </div>
                    <div class="dc3-sig-box">
                        ${sigPatronUrl ? `<div class="dc3-sig-img-container"><img src="${sigPatronUrl}" class="dc3-sig-img" alt="Firma"></div>` : ''}
                        <div class="dc3-sig-val">${patronRep || '--'}</div>
                        <div class="dc3-sig-line">Representante del patrón</div>
                    </div>
                    <div class="dc3-sig-box">
                        ${sigWorkerRepUrl ? `<div class="dc3-sig-img-container"><img src="${sigWorkerRepUrl}" class="dc3-sig-img" alt="Firma"></div>` : ''}
                        <div class="dc3-sig-val">${workerRep || '--'}</div>
                        <div class="dc3-sig-line">Representante de los trabajadores</div>
                    </div>
                </div>
                <div class="dc3-signatures-bottom">
                    <div class="dc3-sig-box">
                        ${sigWorkerUrl ? `<div class="dc3-sig-img-container"><img src="${sigWorkerUrl}" class="dc3-sig-img" alt="Firma"></div>` : ''}
                        <div class="dc3-sig-val">${formattedWorkerName}</div>
                        <div class="dc3-sig-line">Trabajador</div>
                    </div>
                </div>
                ${legendHtml}
            </div>
        `;
        printSection.innerHTML += pageHtml;
    });

    window.print();
}

// --- GESTIÓN DE CURSOS MANUALES ---
function toggleManualCourseForm(show) {
    playSound('click');
    const container = document.getElementById('manual-course-form-container');
    if (container) {
        container.style.display = show ? 'flex' : 'none';
    }
    if (show) {
        document.getElementById('manual-c-name').focus();

        // Populate instructor dropdown
        const instSelect = document.getElementById('manual-c-instructor');
        if (instSelect) {
            instSelect.innerHTML = '<option value="random">Aleatorio (Selección automática)</option>';
            AppState.instructors.forEach(inst => {
                const opt = document.createElement('option');
                opt.value = inst;
                opt.textContent = inst;
                instSelect.appendChild(opt);
            });
        }

        // Clear/reset inputs
        document.getElementById('manual-c-date').value = '';
        document.getElementById('manual-c-instructor').value = 'random';
    } else {
        document.getElementById('manual-c-name').value = '';
        document.getElementById('manual-c-hours').value = '8';
        document.getElementById('manual-c-date').value = '';
    }
}

function addManualCourse() {
    if (!AppState.selectedWorker) return;

    const nameInput = document.getElementById('manual-c-name');
    const hoursInput = document.getElementById('manual-c-hours');
    const typeInput = document.getElementById('manual-c-type');
    const dateInput = document.getElementById('manual-c-date');
    const instSelect = document.getElementById('manual-c-instructor');

    const name = nameInput.value.trim().toUpperCase();
    const hours = parseInt(hoursInput.value);
    const puestoType = typeInput.value;
    const endDateVal = dateInput.value;
    const instructorModeVal = instSelect.value;

    if (!name) {
        showNotification("El nombre del curso es requerido.", true);
        nameInput.style.borderColor = 'var(--danger)';
        return;
    } else {
        nameInput.style.borderColor = 'var(--glass-border)';
    }

    if (isNaN(hours) || hours <= 0) {
        showNotification("Las horas deben ser un número mayor a cero.", true);
        hoursInput.style.borderColor = 'var(--danger)';
        return;
    } else {
        hoursInput.style.borderColor = 'var(--glass-border)';
    }

    const cleanName = AppState.selectedWorker.name.trim().toUpperCase();
    const manualKey = `cfe_manual_courses_${cleanName}`;
    let manualList = JSON.parse(localStorage.getItem(manualKey)) || [];

    // Prevent duplicates
    const isDup = manualList.some(c => c.name.toUpperCase() === name.toUpperCase() && c.puestoType === puestoType);
    if (isDup) {
        showNotification("Este curso manual ya existe para este trabajador.", true);
        return;
    }

    // Save manual course
    manualList.push({
        name: name,
        hours: hours,
        area: '2600-EDUCACION',
        puestoType: puestoType
    });
    localStorage.setItem(manualKey, JSON.stringify(manualList));

    // Save custom state (date and instructor) immediately
    const cleanNameCourse = cleanCourseName(name);
    const stateKey = `cfe_course_state_${cleanName}_${cleanNameCourse}_${puestoType}`;

    const state = {
        endDate: endDateVal ? endDateVal : null,
        instructorMode: instructorModeVal === 'random' ? 'random' : 'manual',
        manualInstructor: instructorModeVal === 'random' ? '' : instructorModeVal,
        selected: true
    };
    localStorage.setItem(stateKey, JSON.stringify(state));

    playSound('success');
    showNotification(`Curso "${name}" agregado correctamente.`);

    // Close form & reload courses
    toggleManualCourseForm(false);
    loadCoursesForSelectedWorker(false); // pass false so we don't reset other selections!

    // Select this new course by default!
    setTimeout(() => {
        const newCourse = AppState.workerCoursesList.find(c => c.name.toUpperCase() === name.toUpperCase() && c.puestoType === puestoType);
        if (newCourse) {
            selectedCourseIds.add(newCourse.id);
            saveCourseState(AppState.selectedWorker.name, newCourse);
            renderCoursesTableForActiveWorker();
            selectCourseForPreview(newCourse);
        }
    }, 50);
}

function deleteManualCourse(courseName, puestoType) {
    if (!AppState.selectedWorker) return;
    if (confirm(`¿Estás seguro de que deseas eliminar el curso manual "${courseName}"?`)) {
        playSound('click');
        const cleanName = AppState.selectedWorker.name.trim().toUpperCase();
        const manualKey = `cfe_manual_courses_${cleanName}`;
        let manualList = JSON.parse(localStorage.getItem(manualKey)) || [];

        manualList = manualList.filter(c => !(c.name.toUpperCase() === courseName.toUpperCase() && c.puestoType === puestoType));
        localStorage.setItem(manualKey, JSON.stringify(manualList));

        // Also delete its custom course state
        const stateKey = `cfe_course_state_${cleanName}_${cleanCourseName(courseName)}_${puestoType}`;
        localStorage.removeItem(stateKey);

        showNotification("Curso manual eliminado.");
        loadCoursesForSelectedWorker(false);

        // Reset active preview course if it was deleted
        if (activePreviewCourseId !== null) {
            const current = AppState.workerCoursesList.find(c => c.id === activePreviewCourseId);
            if (!current) {
                activePreviewCourseId = null;
                if (AppState.workerCoursesList.length > 0) {
                    selectCourseForPreview(AppState.workerCoursesList[0]);
                } else {
                    updateLivePreview(AppState.selectedWorker.name, AppState.selectedWorker.curp, null);
                }
            }
        }
    }
}

// Alphabet Grid Filter Helpers
function initializeAlphabetGrid() {
    const grid = document.getElementById('alphabet-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
    alphabet.forEach(letter => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'letter-btn';
        btn.id = `btn-letter-${letter}`;
        btn.textContent = letter;
        btn.addEventListener('click', () => toggleLetterFilter(letter));
        grid.appendChild(btn);
    });
    updateLetterButtonsUI();
}

function toggleLetterFilter(letter) {
    playSound('click');
    AppState.letterFilterEnabled = true;
    if (AppState.activeLetters.has(letter)) {
        AppState.activeLetters.delete(letter);
    } else {
        AppState.activeLetters.add(letter);
    }
    updateLetterButtonsUI();
    renderWorkerList();
}

function setLetterPreset(preset) {
    playSound('click');
    if (preset === 'all') {
        AppState.activeLetters = new Set();
        AppState.letterFilterEnabled = false;
    } else if (preset === 'none') {
        AppState.activeLetters = new Set();
        AppState.letterFilterEnabled = true;
    }
    updateLetterButtonsUI();
    renderWorkerList();
}

function updateLetterButtonsUI() {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
    alphabet.forEach(letter => {
        const btn = document.getElementById(`btn-letter-${letter}`);
        if (btn) {
            if (AppState.letterFilterEnabled && AppState.activeLetters.has(letter)) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        }
    });
}

// Descargar plantilla de ejemplo de Créditos (.xlsx)
function downloadExampleExcelTemplate() {
    try {
        playSound('click');
        const cappaData = [
            {
                "RPE": "9M7MF",
                "Nombre Completo": "JULIO ANDRES LEON MEJIA",
                "CURP": "LEMJ821130HMCNJL00",
                "Nombre de la Batería": "VERIFICADOR CALIBRADOR I",
                "Nombre del Curso": "PRUEBAS DE RELACIÓN DE TRANSFORMACIÓN, AISLAMIENTO Y POLARIDAD A TRANSFORMADORES DE INSTRUMENTOS",
                "Hrs. Total": 16
            },
            {
                "RPE": "9M7MF",
                "Nombre Completo": "JULIO ANDRES LEON MEJIA",
                "CURP": "LEMJ821130HMCNJL00",
                "Nombre de la Batería": "VERIFICADOR CALIBRADOR I",
                "Nombre del Curso": "OPERACIÓN DEL SISTEMA DE CONTROL Y ADMINISTRACIÓN DE MEDIDORES Y SISTEMAS DE MEDICIÓN",
                "Hrs. Total": 8
            },
            {
                "RPE": "8XY34",
                "Nombre Completo": "CORTEZ LARA BALDOMERO",
                "CURP": "COLB750512MDFRR002",
                "Nombre de la Batería": "LINIERO DE MANTENIMIENTO",
                "Nombre del Curso": "TRABAJOS EN ALTURAS, ACTIVIDADES QUE SALVAN VIDAS Y AISLADO SOBRE ARBOLO",
                "Hrs. Total": 32
            }
        ];

        const cappiData = [
            {
                "RPE": "9M7MF",
                "Nombre Completo": "JULIO ANDRES LEON MEJIA",
                "CURP": "LEMJ821130HMCNJL00",
                "Nombre de la Batería": "VERIFICADOR CALIBRADOR I",
                "Nombre del Curso": "OPERACIÓN Y MANTENIMIENTO DE SUBESTACIONES ELÉCTRICAS",
                "Hrs. Total": 24
            }
        ];

        const wb = XLSX.utils.book_new();

        const wsCappa = XLSX.utils.json_to_sheet(cappaData);
        const wsCappi = XLSX.utils.json_to_sheet(cappiData);

        XLSX.utils.book_append_sheet(wb, wsCappa, "CAPPA");
        XLSX.utils.book_append_sheet(wb, wsCappi, "CAPPI");

        XLSX.writeFile(wb, "PLANTILLA_EJEMPLO_CREDITOS.xlsx");
        showNotification("Se descargó la plantilla de ejemplo 'PLANTILLA_EJEMPLO_CREDITOS.xlsx' con las columnas exactas de Créditos.");
    } catch (e) {
        showNotification("Error al generar plantilla de ejemplo: " + e.message, true);
    }
}

// Page setup onload
window.addEventListener('DOMContentLoaded', () => {
    loadStaticConfig();
    initializeAlphabetGrid();
    restoreSavedState();
});
