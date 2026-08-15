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
// --- CONSTANTES BASE64 PARA FIRMAS PREDETERMINADAS (DESACTIVADAS) ---
const DEFAULT_SIG_DAVID = "";
const DEFAULT_SIG_SERNA = "";

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
    AppState.digitalSignatures = [];
    try {
        localStorage.removeItem('cfe_digital_signatures');
    } catch(e) {}
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
                <div class="sig-card-key" title="Clave: ${s.parsedKey}">Clave: ${s.parsedKey || 'Sin clave'}</div>
            </div>
            <button class="btn btn-secondary" onclick="deleteDigitalSignature('${s.id}')" style="padding:4px 8px; font-size:11px; min-height:unset; background:rgba(248, 113, 113, 0.1); border-color:rgba(248, 113, 113, 0.2); color:#fca5a5;">
                <svg viewBox="0 0 24 24" style="width:12px; height:12px; fill:currentColor;"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
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
            showNotification(`No se puede abrir el Generador CCHL.\nFalta cargar: ${missing.join(' y ')}.`, true);
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
            navBtnGenerate.title = `Requerido: ${reasons.join(', ')}`;
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
        curpErrorEl.textContent = "CURP no asignada";
        curpErrorEl.style.display = 'block';
    } else if (!/^[A-Z0-9]{18}$/.test(cleanCurp)) {
        curpErrorEl.textContent = "CURP Inválida (debe tener 18 caracteres alfanuméricos)";
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
        puestoErrorEl.textContent = "El puesto no puede estar vacío";
        puestoErrorEl.style.display = 'block';
        puestoInput.style.borderColor = 'var(--danger)';
    } else if (!/^\d+$/.test(cleanVal)) {
        puestoErrorEl.textContent = "El puesto debe contener solo dígitos";
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
            showNotification(`No se encontraron trabajadores en "${fileName}". Verifica el contenido del Excel.`, true);
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
                        <div class="dc3-sig-val">${activeInstructor || '--'}</div>
                        <div class="dc3-sig-line">Instructor o Tutor</div>
                    </div>
                    <div class="dc3-sig-box">
                        <div class="dc3-sig-val">${patronRep || '--'}</div>
                        <div class="dc3-sig-line">Representante del patrón</div>
                    </div>
                    <div class="dc3-sig-box">
                        <div class="dc3-sig-val">${workerRep || '--'}</div>
                        <div class="dc3-sig-line">Representante de los trabajadores</div>
                    </div>
                </div>
                <div class="dc3-signatures-bottom">
                    <div class="dc3-sig-box">
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
