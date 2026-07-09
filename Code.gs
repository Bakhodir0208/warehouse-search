/**
 * Google Apps Script для автоматизации процесса поиска товаров на складе.
 * 
 * Инструкция по установке:
 * 1. В вашей Google Таблице выберите: Расширения -> Apps Script.
 * 2. Удалите стандартный код и вставьте этот скрипт.
 * 3. Нажмите "Сохранить" (иконка дискеты).
 * 4. Нажмите кнопку "Начать развертывание" (Deploy) -> "Новое развертывание" (New deployment).
 * 5. Выберите тип развертывания: "Веб-приложение" (Web app).
 * 6. Настройте параметры:
 *    - Описание: "Складской поиск API"
 *    - Запуск от имени: "Вы" (Ваш Google аккаунт)
 *    - Кто имеет доступ: "Все" (Anyone) - это важно для работы мобильного приложения.
 * 7. Нажмите "Развернуть" (Deploy), предоставьте необходимые разрешения.
 * 8. Скопируйте полученный URL веб-приложения (Web app URL). Этот URL нужно будет ввести в настройках мобильного приложения.
 */

// Имена листов
var MAIN_SHEET_NAME = "Рабочий лист";
var LOG_SHEET_NAME = "Детали поиска";
var EMPLOYEE_SHEET_NAME = "Сотрудники";
var LOCK_SHEET_NAME = "Блокировки";

/**
 * Инициализация структуры таблицы (создание недостающих листов).
 */
function initSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 1. Проверяем лист логов
  var logSheet = ss.getSheetByName(LOG_SHEET_NAME);
  if (!logSheet) {
    logSheet = ss.insertSheet(LOG_SHEET_NAME);
    logSheet.appendRow(["Дата проверки", "Индекс строки", "Штрихкод", "Ячейка", "Найдено шт.", "Сотрудник ФИО"]);
    logSheet.getRange(1, 1, 1, 6).setFontWeight("bold").setBackground("#f3f3f3");
    logSheet.setFrozenRows(1);
  }
  
  // 2. Проверяем лист сотрудников
  var empSheet = ss.getSheetByName(EMPLOYEE_SHEET_NAME);
  if (!empSheet) {
    empSheet = ss.insertSheet(EMPLOYEE_SHEET_NAME);
    empSheet.appendRow(["ID", "ФИО"]);
    empSheet.getRange(1, 1, 1, 2).setFontWeight("bold").setBackground("#f3f3f3");
    empSheet.appendRow(["12345", "Иванов Иван Иванович"]); // Тестовый сотрудник
    empSheet.setFrozenRows(1);
  }
  
  // 3. Проверяем лист блокировок
  var lockSheet = ss.getSheetByName(LOCK_SHEET_NAME);
  if (!lockSheet) {
    lockSheet = ss.insertSheet(LOCK_SHEET_NAME);
    lockSheet.appendRow(["Склад", "Этаж", "Сотрудник ФИО", "Дата блокировки"]);
    lockSheet.getRange(1, 1, 1, 4).setFontWeight("bold").setBackground("#f3f3f3");
    lockSheet.setFrozenRows(1);
  }
}

/**
 * Обработка GET-запросов (Авторизация и получение списка задач).
 */
function doGet(e) {
  initSheets();
  var action = e.parameter.action;
  
  if (action === "login") {
    return handleLogin(e.parameter.id);
  } else if (action === "getTasks") {
    return handleGetTasks();
  } else if (action === "getProductInfo") {
    return handleGetProductInfo(e.parameter.productId);
  }
  
  return jsonResponse({ success: false, error: "Неверное действие (action)" });
}

/**
 * Обработка POST-запросов (Сохранение результатов поиска).
 */
function doPost(e) {
  initSheets();
  try {
    var data = JSON.parse(e.postData.contents);
    if (data.action === "submitResult") {
      return handleSubmitResult(data);
    } else if (data.action === "lockZone") {
      return handleLockZone(data);
    } else if (data.action === "unlockZone") {
      return handleUnlockZone(data);
    }
    return jsonResponse({ success: false, error: "Неверное действие в POST" });
  } catch (err) {
    return jsonResponse({ success: false, error: "Ошибка парсинга запроса: " + err.toString() });
  }
}

/**
 * Авторизация сотрудника по ID.
 */
function handleLogin(id) {
  if (!id) {
    return jsonResponse({ success: false, error: "ID не указан" });
  }
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var empSheet = ss.getSheetByName(EMPLOYEE_SHEET_NAME);
  var data = empSheet.getDataRange().getValues();
  
  for (var i = 1; i < data.length; i++) {
    var empId = String(data[i][0]).trim();
    var empFio = String(data[i][1]).trim();
    if (empId === String(id).trim()) {
      return jsonResponse({ success: true, fio: empFio });
    }
  }
  
  return jsonResponse({ success: false, error: "Сотрудник с ID " + id + " не найден" });
}

/**
 * Получение списка невыполненных задач.
 */
function handleGetTasks() {
  cleanExpiredLocks();
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var mainSheet = ss.getSheetByName(MAIN_SHEET_NAME);
  if (!mainSheet) {
    // Если листа с именем "Рабочий лист" нет, берем первый лист
    mainSheet = ss.getSheets()[0];
  }
  
  var logSheet = ss.getSheetByName(LOG_SHEET_NAME);
  
  var mainData = mainSheet.getDataRange().getValues();
  if (mainData.length < 2) {
    return jsonResponse({ success: true, tasks: [] });
  }
  
  var headers = mainData[0];
  var colMap = mapHeaders(headers);
  
  // Проверяем наличие ключевых колонок
  if (colMap.barcode === -1 || colMap.cells === -1 || colMap.warehouse === -1 || colMap.status === -1) {
    return jsonResponse({
      success: false,
      error: "Не удалось найти необходимые колонки в таблице. Проверьте заголовки: 'Шк', 'Ячейка для поиска', 'Склад', 'Статус'."
    });
  }
  
  // Получаем список уже выполненных ячеек из лога
  var checkedCells = {};
  if (logSheet) {
    var logData = logSheet.getDataRange().getValues();
    for (var i = 1; i < logData.length; i++) {
      var rowIdx = String(logData[i][1]).trim();
      var cellName = String(logData[i][3]).trim();
      if (!checkedCells[rowIdx]) {
        checkedCells[rowIdx] = {};
      }
      checkedCells[rowIdx][cellName] = true;
    }
  }
  
  var tasks = [];
  
  // Обходим строки со 2-й (индекс 1)
  for (var r = 1; r < mainData.length; r++) {
    var row = mainData[r];
    var status = String(row[colMap.status]).trim();
    var warehouse = String(row[colMap.warehouse]).trim();
    
    // Если статус пуст и склад заполнен - это задача для поиска
    if (status === "" && warehouse !== "") {
      var barcode = String(row[colMap.barcode]).trim();
      var cellText = String(row[colMap.cells]).trim();
      var targetQty = parseInt(row[colMap.targetQty]) || 0;
      var ticketLink = colMap.ticketLink !== -1 ? String(row[colMap.ticketLink]).trim() : "";
      
      if (!barcode || !cellText) continue;
      
      // Разделяем ячейки (по переносу строки, запятой или точке с запятой)
      var rawCells = cellText.split(/[\n,;]+/);
      var cellsForThisRow = [];
      
      for (var c = 0; c < rawCells.length; c++) {
        var cell = rawCells[c].trim();
        if (cell === "") continue;
        
        // Фильтруем ячейки по формату (например, M1.83.52.5.1)
        if (!/^[A-Za-z0-9]+\.\d+\.\d+\.\d+\.\d+$/.test(cell)) {
          continue;
        }
        
        // Проверяем, была ли эта конкретная ячейка уже проверена для данной строки
        var isChecked = checkedCells[r + 1] && checkedCells[r + 1][cell];
        
        if (!isChecked) {
          cellsForThisRow.push(cell);
        }
      }
      
      // Считаем общее количество только валидных ячеек для этой строки
      var totalValidCellsCount = rawCells.filter(function(x) { 
        return x.trim() !== "" && /^[A-Za-z0-9]+\.\d+\.\d+\.\d+\.\d+$/.test(x.trim()); 
      }).length;
      
      // Если есть непроверенные ячейки, создаем задачи
      for (var k = 0; k < cellsForThisRow.length; k++) {
        var cell = cellsForThisRow[k];
        var finalWarehouse = warehouse;
        
        // Ячейки, начинающиеся с BR, физически расположены на складе Сергели
        if (cell.indexOf("BR") === 0) {
          finalWarehouse = "Сергели";
        }
        
        tasks.push({
          rowIndex: r + 1, // 1-based индекс строки в Google Sheet
          barcode: barcode,
          warehouse: finalWarehouse,
          cell: cell,
          targetQty: targetQty,
          ticketLink: ticketLink,
          totalCellsCount: totalValidCellsCount,
          assignedTo: colMap.employee !== -1 ? String(row[colMap.employee]).trim() : "",
          productId: colMap.productId !== -1 ? String(row[colMap.productId]).trim() : ""
        });
      }
    }
  }
  
  // Считываем активные блокировки
  var locksList = [];
  var lockSheet = ss.getSheetByName(LOCK_SHEET_NAME);
  if (lockSheet) {
    var lockData = lockSheet.getDataRange().getValues();
    for (var i = 1; i < lockData.length; i++) {
      locksList.push({
        warehouse: String(lockData[i][0]).trim(),
        floor: String(lockData[i][1]).trim(),
        employee: String(lockData[i][2]).trim(),
        date: lockData[i][3]
      });
    }
  }
  
  return jsonResponse({ success: true, tasks: tasks, locks: locksList });
}

/**
 * Сохранение результата проверки одной ячейки.
 */
function handleSubmitResult(data) {
  var rowIndex = parseInt(data.rowIndex);
  var barcode = String(data.barcode).trim();
  var cell = String(data.cell).trim();
  var foundQty = parseInt(data.foundQty) || 0;
  var employee = String(data.employee).trim();
  
  if (!rowIndex || !barcode || !cell || !employee) {
    return jsonResponse({ success: false, error: "Не все обязательные параметры переданы (rowIndex, barcode, cell, employee)" });
  }
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var mainSheet = ss.getSheetByName(MAIN_SHEET_NAME) || ss.getSheets()[0];
  var logSheet = ss.getSheetByName(LOG_SHEET_NAME);
  
  // 1. Добавляем запись в лог проверок
  logSheet.appendRow([new Date(), rowIndex, barcode, cell, foundQty, employee]);
  
  // 2. Получаем актуальную строку из главного листа
  var headers = mainSheet.getRange(1, 1, 1, mainSheet.getLastColumn()).getValues()[0];
  var colMap = mapHeaders(headers);
  
  var rowRange = mainSheet.getRange(rowIndex, 1, 1, mainSheet.getLastColumn());
  var rowValues = rowRange.getValues()[0];
  
  var cellText = String(rowValues[colMap.cells]).trim();
  var rawCells = cellText.split(/[\n,;]+/);
  var allRequiredCells = [];
  for (var c = 0; c < rawCells.length; c++) {
    var cl = rawCells[c].trim();
    if (cl !== "") {
      // Учитываем только валидные ячейки
      if (/^[A-Za-z0-9]+\.\d+\.\d+\.\d+\.\d+$/.test(cl)) {
        allRequiredCells.push(cl);
      }
    }
  }
  
  // 3. Проверяем по логу, проверены ли теперь все ячейки для этой строки
  var logData = logSheet.getDataRange().getValues();
  var checkedCellsInfo = {}; // cell -> foundQty
  
  for (var i = 1; i < logData.length; i++) {
    var lRowIndex = parseInt(logData[i][1]);
    if (lRowIndex === rowIndex) {
      var lCell = String(logData[i][3]).trim();
      var lQty = parseInt(logData[i][4]) || 0;
      checkedCellsInfo[lCell] = lQty;
    }
  }
  
  var allChecked = true;
  var totalFoundQty = 0;
  
  for (var k = 0; k < allRequiredCells.length; k++) {
    var reqCell = allRequiredCells[k];
    if (checkedCellsInfo[reqCell] === undefined) {
      allChecked = false; // Какая-то ячейка еще не проверена
    } else {
      totalFoundQty += checkedCellsInfo[reqCell];
    }
  }
  
  // 4. Если все ячейки строки проверены, обновляем статус в главной таблице
  if (allChecked) {
    // Дата поиска
    var todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd.MM.yyyy");
    
    // Статус: "Найден" если нашли хотя бы 1 штуку, иначе "Не найден"
    var finalStatus = totalFoundQty > 0 ? "Найден" : "Не найден";
    
    // Обновляем ячейки
    if (colMap.status !== -1) {
      mainSheet.getRange(rowIndex, colMap.status + 1).setValue(finalStatus);
    }
    if (colMap.foundQty !== -1) {
      mainSheet.getRange(rowIndex, colMap.foundQty + 1).setValue(totalFoundQty);
    }
    if (colMap.employee !== -1) {
      mainSheet.getRange(rowIndex, colMap.employee + 1).setValue(employee);
    }
    if (colMap.searchDate !== -1) {
      mainSheet.getRange(rowIndex, colMap.searchDate + 1).setValue(todayStr);
    }
  }
  
  return jsonResponse({ success: true, allChecked: allChecked, totalFoundQty: totalFoundQty });
}

/**
 * Сопоставление названий колонок с их индексами.
 */
function mapHeaders(headers) {
  var colMap = {
    ticketLink: -1,
    barcode: -1,
    targetQty: -1,
    searchDate: -1,
    cells: -1,
    warehouse: -1,
    status: -1,
    foundQty: -1,
    employee: -1,
    productId: -1
  };
  
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i]).trim().toLowerCase();
    
    if (h.indexOf("ссылка") === 0 || h.indexOf("заявк") !== -1) {
      colMap.ticketLink = i;
    } else if (h === "шк" || h === "штрихкод" || h === "штрих-код") {
      colMap.barcode = i;
    } else if (h === "кол-во для поиска" || h === "кол во для поиска" || h.indexOf("кол-во") === 0) {
      colMap.targetQty = i;
    } else if (h === "дата поиска") {
      colMap.searchDate = i;
    } else if (h === "ячейка для поиска" || h === "ячейка" || h.indexOf("ячейка") === 0) {
      colMap.cells = i;
    } else if (h === "склад") {
      colMap.warehouse = i;
    } else if (h === "статус") {
      colMap.status = i;
    } else if (h === "найденное количество" || h === "найдено шт" || h === "найдено количество") {
      colMap.foundQty = i;
    } else if (h === "сотрудник аналитики" || h === "сотрудник" || h.indexOf("сотрудник") === 0) {
      colMap.employee = i;
    } else if (h === "product_id" || h === "productid" || h === "id товара" || h === "айди товара") {
      colMap.productId = i;
    }
  }
  
  return colMap;
}

/**
 * Формирование JSON-ответа.
 */
function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Очистка устаревших блокировок (старше 4 часов).
 */
function cleanExpiredLocks() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var lockSheet = ss.getSheetByName(LOCK_SHEET_NAME);
  if (!lockSheet) return;
  
  var data = lockSheet.getDataRange().getValues();
  if (data.length < 2) return;
  
  var now = new Date().getTime();
  var fourHoursMs = 4 * 60 * 60 * 1000;
  
  // Обходим снизу вверх, чтобы не сбивались индексы при удалении
  for (var i = data.length - 1; i >= 1; i--) {
    var lockTime = new Date(data[i][3]).getTime();
    if (isNaN(lockTime) || (now - lockTime > fourHoursMs)) {
      lockSheet.deleteRow(i + 1);
    }
  }
}

/**
 * Блокировка (резервирование) зоны сотрудником.
 */
function handleLockZone(data) {
  var warehouse = String(data.warehouse).trim();
  var floor = String(data.floor).trim();
  var employee = String(data.employee).trim();
  
  if (!warehouse || !floor || !employee) {
    return jsonResponse({ success: false, error: "Не все параметры переданы (warehouse, floor, employee)" });
  }
  
  cleanExpiredLocks();
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var lockSheet = ss.getSheetByName(LOCK_SHEET_NAME);
  var lockData = lockSheet.getDataRange().getValues();
  
  var activeLockIndex = -1;
  var lockedBy = "";
  
  // Ищем существующую блокировку для этой зоны
  for (var i = 1; i < lockData.length; i++) {
    var lWarehouse = String(lockData[i][0]).trim();
    var lFloor = String(lockData[i][1]).trim();
    if (lWarehouse === warehouse && lFloor === floor) {
      activeLockIndex = i + 1;
      lockedBy = String(lockData[i][2]).trim();
      break;
    }
  }
  
  // Если зона заблокирована кем-то другим
  if (activeLockIndex !== -1 && lockedBy !== employee) {
    return jsonResponse({ success: false, error: "Эта зона уже занята сотрудником: " + lockedBy });
  }
  
  // Если зона уже заблокирована этим же сотрудником — обновляем время
  if (activeLockIndex !== -1 && lockedBy === employee) {
    lockSheet.getRange(activeLockIndex, 4).setValue(new Date());
    return jsonResponse({ success: true });
  }
  
  // Иначе создаем новую блокировку
  lockSheet.appendRow([warehouse, floor, employee, new Date()]);
  return jsonResponse({ success: true });
}

/**
 * Разблокировка (освобождение) зоны сотрудником.
 */
function handleUnlockZone(data) {
  var warehouse = String(data.warehouse).trim();
  var floor = String(data.floor).trim();
  var employee = String(data.employee).trim();
  
  if (!warehouse || !floor || !employee) {
    return jsonResponse({ success: false, error: "Не все параметры переданы (warehouse, floor, employee)" });
  }
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var lockSheet = ss.getSheetByName(LOCK_SHEET_NAME);
  var lockData = lockSheet.getDataRange().getValues();
  
  // Ищем и удаляем строку блокировки
  for (var i = lockData.length - 1; i >= 1; i--) {
    var lWarehouse = String(lockData[i][0]).trim();
    var lFloor = String(lockData[i][1]).trim();
    var lEmployee = String(lockData[i][2]).trim();
    
    if (lWarehouse === warehouse && lFloor === floor && lEmployee === employee) {
      lockSheet.deleteRow(i + 1);
    }
  }
  
  return jsonResponse({ success: true });
}

/**
 * Получение названия и фото товара по productId с Uzum API.
 */
function handleGetProductInfo(productId) {
  if (!productId) {
    return jsonResponse({ success: false, error: "productId не указан" });
  }
  try {
    var url = "https://api.uzum.uz/api/v2/product/" + productId;
    var response = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, y Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json"
      }
    });
    var responseCode = response.getResponseCode();
    if (responseCode === 200) {
      var content = JSON.parse(response.getContentText());
      if (content && content.payload) {
        var title = content.payload.title || "";
        var photoKey = (content.payload.photos && content.payload.photos.length > 0) ? content.payload.photos[0].key : "";
        return jsonResponse({
          success: true,
          title: title,
          photoKey: photoKey
        });
      }
    }
    return jsonResponse({ success: false, error: "Не удалось получить данные товара, код: " + responseCode });
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}
