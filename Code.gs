function doGet(e) {
  try {
    const action = e.parameter.action;

    if (action === "catalogo") {
      return jsonResponse(getCatalogo());
    }

    return jsonResponse("Acción inválida", false);

  } catch (err) {
    return jsonResponse(err.toString(), false);
  }
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    if (data.action === "syncBatch") {
      return jsonResponse(syncBatch(data.data));
    }

    if (data.action === "deleteCaja") {
      return jsonResponse(deleteCaja(data.id));
    }

    return jsonResponse("Acción POST inválida", false);

  } catch (err) {
    return jsonResponse(err.toString(), false);
  }
}

// =======================
// RESPUESTA
// =======================
function jsonResponse(obj, success = true) {
  return ContentService
    .createTextOutput(JSON.stringify({
      success: success,
      data: success ? obj : null,
      error: success ? null : obj
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

// =======================
// CATÁLOGO
// =======================
function getCatalogo() {
  return {
    productos: getSheetData("Productos"),
    categorias: getSheetData("Categorias"),
    mediosPago: getSheetData("MediosPago")
  };
}

// =======================
// LECTURA SHEETS
// =======================
function getSheetData(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(name);

  if (!sheet) throw new Error("No existe hoja: " + name);

  const data = sheet.getDataRange().getDisplayValues();
  const headers = data.shift();

  return data.map(row => {
    let obj = {};

    headers.forEach((h, i) => {
      let val = row[i];

      // Limpieza segura: Solo si es string y parece moneda/número formateado
      if (typeof val === "string" && val !== "") {
        let cleanVal = val.trim();
        
        // Si parece un precio ($ 1.234,56 o similar)
        if (cleanVal.includes('$') || (cleanVal.includes(',') && !isNaN(cleanVal.replace(/\./g, "").replace(",", ".")))) {
          cleanVal = cleanVal
            .replace(/\$/g, "")
            .replace(/\./g, "")
            .replace(",", ".")
            .trim();
        }

        // Intentar convertir a número si es un valor numérico puro
        if (!isNaN(cleanVal) && cleanVal !== "" && !cleanVal.startsWith('0')) {
          val = Number(cleanVal);
        } else {
          val = cleanVal;
        }
      }

      obj[h] = val;
    });

    return obj;
  });
}

// =======================
// SYNC (GUARDA CAJA)
// =======================
function syncBatch(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetCaja = ss.getSheetByName("Caja");

  if (!sheetCaja) throw new Error("No existe hoja Caja");

  let ventasProcesadas = [];
  let cajaProcesada = [];

  // GUARDAR CAJA
  data.caja.forEach(c => {

    sheetCaja.appendRow([
      c.IDMovimientoCaja,                         // IDCaja
      new Date(c.FechaHora),                      // FechaHora
      c.TipoMovimiento,                           // TipoMovimiento
      c.TipoMovimiento === 'INGRESO' ? 'Ingreso' : 'Gasto', // Concepto
      'MANUAL',                                   // OrigenReferencia
      '',                                         // IDReferencia
      c.Monto,                                    // Monto
      c.IDMedioPago || 'EFECTIVO',                // Medio pago
      c.IDSucursal,                               // Sucursal
      c.IDUsuario,                                // Usuario
      'Confirmado',                               // Estado
      c.Observaciones || ''                       // Observaciones
    ]);

    cajaProcesada.push(c.IDMovimientoCaja);
  });

  // VENTAS (placeholder)
  ventasProcesadas = data.ventas.map(v => v.IDVenta);

  return {
    ventasProcesadas,
    cajaProcesada
  };
}

// =======================
// DELETE CAJA (REAL)
// =======================
function deleteCaja(id) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Caja");
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === id) {
      sheet.deleteRow(i + 1);
      return { ok: true };
    }
  }

  return { ok: false, error: "No encontrado" };
}