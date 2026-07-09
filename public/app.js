// app.js - Логика работы приложения складского поиска

// Конфигурация по умолчанию. Если пустая строка, приложение может работать в ДЕМО-режиме.
const DEFAULT_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxwjB5nnzw4hqMveyFjehz_0B84QAKGdxPE5Mx9zR9HArYxs8eIVdzraGwsTlUi8JDD/exec"; 

// Глобальное состояние
const state = {
  scriptUrl: '',
  employeeId: '',
  employeeFio: '',
  selectedWarehouse: 'Фулфилмент',
  selectedFloor: null,
  tasks: [],
  filteredTasks: [],
  currentTaskIndex: 0,
  scanner: null,
  isBarcodeVerified: false,
  isDemoMode: false,
  locks: []
};

// Элементы UI
const ui = {
  loader: document.getElementById('loaderOverlay'),
  loaderText: document.getElementById('loaderText'),
  toast: document.getElementById('alertToast'),
  welcome: document.getElementById('welcomeUser'),
  headerTitle: document.getElementById('appHeaderTitle'),
  demoBadge: document.getElementById('demoBadge'),
  
  // Экраны
  screens: {
    settings: document.getElementById('screen-settings'),
    login: document.getElementById('screen-login'),
    select: document.getElementById('screen-select'),
    task: document.getElementById('screen-task'),
    done: document.getElementById('screen-done')
  },
  
  // Поля ввода
  inputs: {
    scriptUrl: document.getElementById('scriptUrlInput'),
    employeeId: document.getElementById('employeeIdInput')
  },
  
  // Кнопки настроек/входа
  buttons: {
    saveSettings: document.getElementById('btnSaveSettings'),
    demoMode: document.getElementById('btnDemoMode'),
    backToSettings: document.getElementById('btnBackToSettings'),
    login: document.getElementById('btnLogin'),
    logout: document.getElementById('btnLogout'),
    startSearch: document.getElementById('btnStartSearch'),
    backToSelect: document.getElementById('btnBackToSelect'),
    refreshTasks: document.getElementById('btnRefreshTasks')
  },
  
  // Элементы экрана выбора
  warehouseSelect: document.getElementById('warehouseSelect'),
  floorGrid: document.getElementById('floorSelectGrid'),
  noTasksMsg: document.getElementById('noTasksMessage'),
  
  // Элементы экрана задачи
  task: {
    progressLabel: document.getElementById('taskProgressLabel'),
    percentLabel: document.getElementById('taskPercentLabel'),
    progressBar: document.getElementById('taskProgressBar'),
    cell: document.getElementById('taskCell'),
    barcode: document.getElementById('taskBarcode'),
    targetQty: document.getElementById('taskTargetQty'),
    cellsCount: document.getElementById('taskCellsCount'),
    ticketLink: document.getElementById('taskTicketLink'),
    ticketContainer: document.getElementById('ticketLinkContainer'),
    qtyVal: document.getElementById('qtyVal'),
    btnMinus: document.getElementById('btnQtyMinus'),
    btnPlus: document.getElementById('btnQtyPlus'),
    btnNotFound: document.getElementById('btnNotFound'),
    btnFound: document.getElementById('btnFound'),
    btnSkip: document.getElementById('btnSkipTask'),
    btnExit: document.getElementById('btnExitTask'),
    btnWmsInfo: document.getElementById('btnWmsInfo'),
    productLink: document.getElementById('productLink')
  }
};

// Инициализация при загрузке страницы
window.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  setupEventListeners();
});

// Загрузка настроек из LocalStorage
function loadSettings() {
  state.scriptUrl = DEFAULT_SCRIPT_URL || localStorage.getItem('ws_script_url') || '';
  state.employeeId = localStorage.getItem('ws_employee_id') || '';
  state.employeeFio = localStorage.getItem('ws_employee_fio') || '';
  
  ui.inputs.scriptUrl.value = state.scriptUrl;
  ui.inputs.employeeId.value = state.employeeId;
  
  if (state.scriptUrl === 'demo' || (!state.scriptUrl && !DEFAULT_SCRIPT_URL)) {
    state.isDemoMode = true;
    state.scriptUrl = 'demo';
    ui.demoBadge.style.display = 'inline-block';
  } else {
    state.isDemoMode = false;
    ui.demoBadge.style.display = 'none';
  }
  
  if (state.scriptUrl) {
    if (!state.employeeFio) {
      showScreen('login');
    } else {
      ui.welcome.textContent = state.employeeFio; // Полное ФИО
      ui.welcome.style.display = 'block';
      showScreen('select');
      fetchTasks();
    }
  } else {
    showScreen('settings');
  }
}

// Переключение экранов
function showScreen(screenName) {
  Object.keys(ui.screens).forEach(key => {
    if (key === screenName) {
      ui.screens[key].classList.add('active');
    } else {
      ui.screens[key].classList.remove('active');
    }
  });
  
  // Изменяем заголовок в зависимости от экрана
  if (screenName === 'settings') {
    ui.headerTitle.textContent = 'Настройки';
    ui.welcome.style.display = 'none';
  } else if (screenName === 'login') {
    ui.headerTitle.textContent = 'Вход';
    ui.welcome.style.display = 'none';
  } else if (screenName === 'select') {
    ui.headerTitle.textContent = 'Склад';
    if (state.employeeFio) {
      ui.welcome.textContent = state.employeeFio;
      ui.welcome.style.display = 'block';
    }
  } else if (screenName === 'task') {
    ui.headerTitle.textContent = 'Поиск';
  } else if (screenName === 'done') {
    ui.headerTitle.textContent = 'Готово!';
  }
}

// Отображение тоста-уведомления
function showToast(message, isError = true) {
  ui.toast.textContent = message;
  ui.toast.style.background = isError ? 'rgba(244, 63, 94, 0.95)' : 'rgba(16, 185, 129, 0.95)';
  ui.toast.style.display = 'block';
  
  setTimeout(() => {
    ui.toast.style.display = 'none';
  }, 3000);
}

// Показ лоадера
function showLoader(text = 'Загрузка...') {
  ui.loaderText.textContent = text;
  ui.loader.style.display = 'flex';
}

// Скрытие лоадера
function hideLoader() {
  ui.loader.style.display = 'none';
}

// API Запросы
async function apiGet(params = {}) {
  if (state.isDemoMode) {
    await new Promise(resolve => setTimeout(resolve, 300));
    if (params.action === 'login') {
      if (params.id.trim() === 'test_conn') return { success: true };
      return { success: true, fio: 'Иванов Иван Иванович' };
    } else if (params.action === 'getTasks') {
      return {
        success: true,
        tasks: [
          { rowIndex: 2, barcode: '1000014251886', warehouse: 'Фулфилмент', cell: 'M1.83.52.5.1', targetQty: 2, ticketLink: 'https://jsm.uzum.com/browse/WH-101', totalCellsCount: 3, assignedTo: '', productId: '364004' },
          { rowIndex: 2, barcode: '1000014251886', warehouse: 'Фулфилмент', cell: 'M1.83.52.5.2', targetQty: 1, ticketLink: 'https://jsm.uzum.com/browse/WH-101', totalCellsCount: 3, assignedTo: '', productId: '364004' },
          { rowIndex: 3, barcode: '2000031846129', warehouse: 'Фулфилмент', cell: 'M1.84.12.3.1', targetQty: 5, ticketLink: '', totalCellsCount: 1, assignedTo: '', productId: '435478' },
          { rowIndex: 4, barcode: '3000094827163', warehouse: 'Сергели', cell: 'S2.10.15.1.1', targetQty: 1, ticketLink: 'https://jsm.uzum.com/browse/WH-102', totalCellsCount: 2, assignedTo: '', productId: '472922' },
          { rowIndex: 4, barcode: '3000094827163', warehouse: 'Сергели', cell: 'S2.10.15.1.2', targetQty: 3, ticketLink: 'https://jsm.uzum.com/browse/WH-102', totalCellsCount: 2, assignedTo: '', productId: '472922' },
          { rowIndex: 5, barcode: '4000012345678', warehouse: 'Фулфилмент', cell: 'M2.10.20.1.1', targetQty: 1, ticketLink: '', totalCellsCount: 1, assignedTo: '', productId: '832407' },
          { rowIndex: 6, barcode: '5000012345678', warehouse: 'Фулфилмент', cell: 'M3.10.20.1.1', targetQty: 2, ticketLink: 'https://jsm.uzum.com/browse/WH-103', totalCellsCount: 1, assignedTo: 'Иванов Иван Иванович', productId: '364004' },
          { rowIndex: 7, barcode: '6000012345678', warehouse: 'Фулфилмент', cell: 'M3.10.20.1.2', targetQty: 1, ticketLink: '', totalCellsCount: 1, assignedTo: 'Петров Петр Петрович', productId: '435478' }
        ],
        locks: [
          { warehouse: 'Фулфилмент', floor: 'M2', employee: 'Иванов Иван Иванович' },
          { warehouse: 'Сергели', floor: 'S2', employee: 'Петров Петр Петрович' }
        ]
      };
    }
    return { success: false, error: 'Неизвестный action в демо' };
  }

  const url = new URL(state.scriptUrl);
  Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));
  
  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      mode: 'cors'
    });
    if (!response.ok) throw new Error('Сетевая ошибка при запросе');
    return await response.json();
  } catch (error) {
    console.error('API Error:', error);
    throw error;
  }
}

async function apiPost(payload = {}) {
  if (state.isDemoMode) {
    await new Promise(resolve => setTimeout(resolve, 300));
    if (payload.action === 'submitResult') {
      return { success: true, allChecked: true, totalFoundQty: payload.foundQty };
    } else if (payload.action === 'lockZone') {
      return { success: true };
    } else if (payload.action === 'unlockZone') {
      return { success: true };
    }
    return { success: false, error: 'Неизвестный action в демо' };
  }

  try {
    const response = await fetch(state.scriptUrl, {
      method: 'POST',
      mode: 'cors',
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error('Сетевая ошибка при отправке');
    return await response.json();
  } catch (error) {
    console.error('API Error:', error);
    throw error;
  }
}

// Настройка обработчиков событий
function setupEventListeners() {
  // Скрытый доступ к настройкам по 5 кликам по заголовку
  let headerClicks = 0;
  ui.headerTitle.addEventListener('click', () => {
    headerClicks++;
    if (headerClicks >= 5) {
      headerClicks = 0;
      showToast('Доступ к настройкам открыт', false);
      showScreen('settings');
    }
  });

  // Запуск демо-режима
  ui.buttons.demoMode.addEventListener('click', () => {
    state.isDemoMode = true;
    state.scriptUrl = 'demo';
    localStorage.setItem('ws_script_url', 'demo');
    ui.demoBadge.style.display = 'inline-block';
    showToast('Вход в ДЕМО-режим...', false);
    showScreen('login');
  });

  // В этом месте больше нет необходимости в эмуляции клика, так как он заменен на копирование штрихкода

  // Сохранить URL
  ui.buttons.saveSettings.addEventListener('click', async () => {
    const url = ui.inputs.scriptUrl.value.trim();
    if (!url) {
      showToast('Введите корректный URL');
      return;
    }
    
    showLoader('Проверка подключения...');
    try {
      // Пробуем вызвать с тестовым экшеном
      const testUrl = new URL(url);
      testUrl.searchParams.append('action', 'login');
      testUrl.searchParams.append('id', 'test_conn');
      
      const response = await fetch(testUrl.toString(), { mode: 'cors' });
      if (response.ok) {
        state.scriptUrl = url;
        state.isDemoMode = false;
        ui.demoBadge.style.display = 'none';
        localStorage.setItem('ws_script_url', url);
        showToast('Подключение успешно настроено!', false);
        showScreen('login');
      } else {
        throw new Error('Некорректный ответ от API');
      }
    } catch (err) {
      showToast('Ошибка подключения. Проверьте URL скрипта!');
      console.error(err);
    } finally {
      hideLoader();
    }
  });

  // Возврат на экран настроек
  ui.buttons.backToSettings.addEventListener('click', () => {
    showScreen('settings');
  });

  // Вход по ID
  ui.buttons.login.addEventListener('click', async () => {
    const id = ui.inputs.employeeId.value.trim();
    if (!id) {
      showToast('Введите ID сотрудника');
      return;
    }
    
    showLoader('Авторизация...');
    try {
      const res = await apiGet({ action: 'login', id: id });
      if (res.success) {
        state.employeeId = id;
        state.employeeFio = res.fio;
        localStorage.setItem('ws_employee_id', id);
        localStorage.setItem('ws_employee_fio', res.fio);
        
        ui.welcome.textContent = res.fio;
        ui.welcome.style.display = 'block';
        
        showToast('Вход выполнен!', false);
        showScreen('select');
        fetchTasks();
      } else {
        showToast(res.error || 'Неверный ID');
      }
    } catch (err) {
      showToast('Ошибка при входе. Попробуйте еще раз.');
    } finally {
      hideLoader();
    }
  });

  // Смена пользователя (Выход)
  ui.buttons.logout.addEventListener('click', () => {
    localStorage.removeItem('ws_employee_id');
    localStorage.removeItem('ws_employee_fio');
    state.employeeId = '';
    state.employeeFio = '';
    ui.inputs.employeeId.value = '';
    showScreen('login');
  });

  // Переключение складов
  const warehouseBtns = ui.warehouseSelect.querySelectorAll('.segment-btn');
  warehouseBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      warehouseBtns.forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      state.selectedWarehouse = e.target.getAttribute('data-value');
      state.selectedFloor = null;
      ui.buttons.startSearch.disabled = true;
      populateFloors();
    });
  });

  // Кнопка обновления задач
  ui.buttons.refreshTasks.addEventListener('click', () => {
    // Вращаем иконку при клике для микро-анимации
    const svg = ui.buttons.refreshTasks.querySelector('svg');
    if (svg) {
      svg.style.transition = 'transform 0.6s ease';
      svg.style.transform = 'rotate(360deg)';
      setTimeout(() => {
        svg.style.transition = 'none';
        svg.style.transform = 'rotate(0deg)';
      }, 600);
    }
    fetchTasks();
  });

  // Начать поиск (с блокировкой зоны)
  ui.buttons.startSearch.addEventListener('click', async () => {
    if (!state.selectedWarehouse || !state.selectedFloor) return;
    
    if (state.selectedWarehouse === 'Назначено мне') {
      prepareSearchRoute();
      return;
    }
    
    showLoader('Блокировка зоны...');
    try {
      const res = await apiPost({
        action: 'lockZone',
        warehouse: state.selectedWarehouse,
        floor: state.selectedFloor,
        employee: state.employeeFio
      });
      
      if (res.success) {
        prepareSearchRoute();
      } else {
        showToast(res.error || 'Зона уже занята другим сотрудником');
        fetchTasks(); // Обновляем список блокировок
      }
    } catch (err) {
      showToast('Ошибка сети при блокировке зоны');
    } finally {
      hideLoader();
    }
  });

  // Управление счетчиком
  ui.task.btnMinus.addEventListener('click', () => {
    let val = parseInt(ui.task.qtyVal.textContent) || 0;
    if (val > 0) {
      ui.task.qtyVal.textContent = val - 1;
    }
  });

  ui.task.btnPlus.addEventListener('click', () => {
    let val = parseInt(ui.task.qtyVal.textContent) || 0;
    ui.task.qtyVal.textContent = val + 1;
  });

  // Копирование штрихкода в буфер обмена
  const copyBarcodeAction = () => {
    const barcodeText = ui.task.barcode.textContent.trim();
    if (barcodeText) {
      navigator.clipboard.writeText(barcodeText).then(() => {
        showToast('Штрихкод скопирован!', false);
      }).catch(err => {
        const textArea = document.createElement("textarea");
        textArea.value = barcodeText;
        textArea.style.position = "fixed";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
          document.execCommand('copy');
          showToast('Штрихкод скопирован!', false);
        } catch (e) {
          showToast('Не удалось скопировать штрихкод');
        }
        document.body.removeChild(textArea);
      });
    }
  };

  // Переход на страницу продукта в WMS
  const openWmsInfoAction = () => {
    const barcodeText = ui.task.barcode.textContent.trim();
    if (barcodeText) {
      const isAndroid = /Android/i.test(navigator.userAgent);
      let url;
      if (isAndroid) {
        // Форсируем запуск Chrome на Android
        url = `intent://wms.uzum.uz/information/product/${barcodeText}#Intent;scheme=https;package=com.android.chrome;end`;
      } else {
        url = `https://wms.uzum.uz/information/product/${barcodeText}`;
      }
      window.open(url, '_blank');
    }
  };

  ui.task.btnWmsInfo.addEventListener('click', openWmsInfoAction);
  ui.task.barcode.addEventListener('click', copyBarcodeAction);

  // Действия по задаче с подтверждением
  ui.task.btnFound.addEventListener('click', () => {
    const qty = parseInt(ui.task.qtyVal.textContent) || 0;
    showConfirmModal(qty, true);
  });

  ui.task.btnNotFound.addEventListener('click', () => {
    showConfirmModal(0, false);
  });

  // Кнопки модального окна подтверждения
  const btnConfirmYes = document.getElementById('btnConfirmYes');
  const btnConfirmCancel = document.getElementById('btnConfirmCancel');
  
  if (btnConfirmYes) {
    btnConfirmYes.addEventListener('click', () => {
      hideConfirmModal();
      submitTaskResult(pendingSubmitQty);
    });
  }
  
  if (btnConfirmCancel) {
    btnConfirmCancel.addEventListener('click', () => {
      hideConfirmModal();
    });
  }

  ui.task.btnSkip.addEventListener('click', () => {
    advanceTask(true); // Пропускаем
  });

  ui.task.btnExit.addEventListener('click', async () => {
    showLoader('Освобождение зоны...');
    await unlockCurrentZone();
    hideLoader();
    showScreen('select');
    fetchTasks();
  });

  ui.buttons.backToSelect.addEventListener('click', async () => {
    showLoader('Освобождение зоны...');
    await unlockCurrentZone();
    hideLoader();
    showScreen('select');
    fetchTasks();
  });

  // Кнопка сброса кэша на экране настроек
  const btnClearCache = document.getElementById('btnClearCache');
  if (btnClearCache) {
    btnClearCache.addEventListener('click', async () => {
      showLoader('Сброс кэша...');
      try {
        if ('serviceWorker' in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          for (let registration of registrations) {
            await registration.unregister();
          }
        }
        if (window.caches) {
          const keys = await caches.keys();
          for (let key of keys) {
            await caches.delete(key);
          }
        }
        localStorage.clear();
        showToast('Кэш успешно очищен!', false);
        setTimeout(() => {
          window.location.reload(true);
        }, 1000);
      } catch (e) {
        showToast('Ошибка при очистке кэша');
      } finally {
        hideLoader();
      }
    });
  }
}

// Загрузка задач с сервера
async function fetchTasks() {
  showLoader('Загрузка списка задач...');
  try {
    const res = await apiGet({ action: 'getTasks' });
    if (res.success) {
      state.tasks = res.tasks || [];
      state.locks = res.locks || [];
      updateWarehouseTabLabels();
      populateFloors();
    } else {
      showToast(res.error || 'Ошибка загрузки задач');
    }
  } catch (err) {
    showToast('Не удалось загрузить задачи с сервера');
  } finally {
    hideLoader();
  }
}

// Генерация кнопок этажей
function populateFloors() {
  ui.floorGrid.innerHTML = '';
  
  // Фильтруем задачи по складу
  let warehouseTasks;
  if (state.selectedWarehouse === 'Назначено мне') {
    warehouseTasks = state.tasks.filter(t => t.assignedTo === state.employeeFio);
  } else {
    warehouseTasks = state.tasks.filter(t => t.warehouse === state.selectedWarehouse && (!t.assignedTo || t.assignedTo.trim() === ''));
  }
  
  if (warehouseTasks.length === 0) {
    ui.floorGrid.style.display = 'none';
    ui.noTasksMsg.style.display = 'flex';
    ui.buttons.startSearch.disabled = true;
    return;
  }
  
  ui.floorGrid.style.display = 'grid';
  ui.noTasksMsg.style.display = 'none';

  // Извлекаем этажи (первая часть до первой точки, напр. M1 из M1.83.52.5.1)
  const floorSet = new Set();
  warehouseTasks.forEach(task => {
    const cell = task.cell || '';
    const floor = cell.split('.')[0] || 'Неизвестно';
    floorSet.add(floor);
  });

  // Сортируем этажи
  const sortedFloors = Array.from(floorSet).sort((a, b) => {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  });

  sortedFloors.forEach(floor => {
    // Подсчет задач на этом этаже
    const count = warehouseTasks.filter(t => (t.cell.split('.')[0] || 'Неизвестно') === floor).length;
    
    // Проверяем блокировку этой зоны другим сотрудником (игнорируем в режиме "Назначено мне")
    let isLockedByOther = false;
    let lockInfo = null;
    if (state.selectedWarehouse !== 'Назначено мне') {
      lockInfo = state.locks ? state.locks.find(l => l.warehouse === state.selectedWarehouse && l.floor === floor) : null;
      isLockedByOther = lockInfo && lockInfo.employee !== state.employeeFio;
    }
    
    const btn = document.createElement('button');
    
    if (isLockedByOther) {
      btn.className = 'grid-btn locked';
      btn.disabled = true;
      const lastName = lockInfo.employee.split(' ')[0] || 'Занят';
      btn.innerHTML = `<span style="font-size:1.2rem; font-weight:800; display:block;">${floor}</span><span style="font-size:0.65rem; color:var(--danger-color); font-weight:bold; word-break:break-all;">${lastName}</span>`;
    } else {
      btn.className = 'grid-btn';
      btn.innerHTML = `<span style="font-size:1.2rem; font-weight:800; display:block;">${floor}</span><span style="font-size:0.75rem; opacity:0.7;">(${count} тов.)</span>`;
      
      if (state.selectedFloor === floor) {
        btn.classList.add('active');
      }
      
      btn.addEventListener('click', (e) => {
        const allGridBtns = ui.floorGrid.querySelectorAll('.grid-btn');
        allGridBtns.forEach(b => b.classList.remove('active'));
        
        const targetBtn = e.target.closest('.grid-btn');
        targetBtn.classList.add('active');
        state.selectedFloor = targetBtn.getAttribute('data-floor');
        ui.buttons.startSearch.disabled = false;
      });
    }
    
    btn.setAttribute('data-floor', floor);
    ui.floorGrid.appendChild(btn);
  });
}

// Сортировка по оптимальному пути на складе
function sortTasksByLocation(tasksList) {
  return tasksList.sort((a, b) => {
    const cellA = a.cell || '';
    const cellB = b.cell || '';
    
    const partsA = cellA.split('.');
    const partsB = cellB.split('.');
    
    // 1. Сравниваем Ряд (второй компонент)
    const rowA = parseInt(partsA[1]) || 0;
    const rowB = parseInt(partsB[1]) || 0;
    if (rowA !== rowB) return rowA - rowB;
    
    // 2. Сравниваем Стеллаж (третий компонент)
    const rackA = parseInt(partsA[2]) || 0;
    const rackB = parseInt(partsB[2]) || 0;
    if (rackA !== rackB) return rackA - rackB;
    
    // 3. Сравниваем Ярус (четвертый компонент)
    const lvlA = parseInt(partsA[3]) || 0;
    const lvlB = parseInt(partsB[3]) || 0;
    if (lvlA !== lvlB) return lvlA - lvlB;
    
    // 4. Сравниваем Позицию (пятый компонент)
    const posA = parseInt(partsA[4]) || 0;
    const posB = parseInt(partsB[4]) || 0;
    return posA - posB;
  });
}

// Подготовка маршрута поиска
function prepareSearchRoute() {
  if (!state.selectedWarehouse || !state.selectedFloor) return;
  
  // Фильтруем задачи
  let rawFiltered;
  if (state.selectedWarehouse === 'Назначено мне') {
    rawFiltered = state.tasks.filter(t => {
      const floor = t.cell.split('.')[0] || 'Неизвестно';
      return t.assignedTo === state.employeeFio && floor === state.selectedFloor;
    });
  } else {
    rawFiltered = state.tasks.filter(t => {
      const floor = t.cell.split('.')[0] || 'Неизвестно';
      return t.warehouse === state.selectedWarehouse && floor === state.selectedFloor && (!t.assignedTo || t.assignedTo.trim() === '');
    });
  }
  
  if (rawFiltered.length === 0) {
    showToast('Нет задач для выбранной зоны');
    return;
  }
  
  // Сортируем задачи по оптимальному маршруту
  state.filteredTasks = sortTasksByLocation(rawFiltered);
  state.currentTaskIndex = 0;
  
  showScreen('task');
  renderCurrentTask();
}

// Отображение текущей задачи
function renderCurrentTask() {
  const task = state.filteredTasks[state.currentTaskIndex];
  if (!task) {
    showScreen('done');
    return;
  }
  
  // Прогресс
  const currentNum = state.currentTaskIndex + 1;
  const total = state.filteredTasks.length;
  const percent = Math.round((state.currentTaskIndex / total) * 100);
  
  ui.task.progressLabel.textContent = `Товар ${currentNum} из ${total}`;
  ui.task.percentLabel.textContent = `${percent}%`;
  ui.task.progressBar.style.width = `${percent}%`;
  
  // Данные задачи
  ui.task.cell.textContent = task.cell;
  ui.task.barcode.textContent = task.barcode;
  ui.task.targetQty.textContent = `${task.targetQty} шт.`;
  ui.task.cellsCount.textContent = task.totalCellsCount;
  
  // Отображение кнопки перехода на Uzum
  if (ui.task.productLink) {
    if (task.productId) {
      ui.task.productLink.href = `https://uzum.uz/ru/product/${task.productId}`;
      ui.task.productLink.style.display = 'flex';
    } else {
      ui.task.productLink.style.display = 'none';
      ui.task.productLink.href = '#';
    }
  }
  
  // Ссылка на заявку
  if (ui.task.ticketLink && ui.task.ticketContainer) {
    if (task.ticketLink) {
      ui.task.ticketLink.href = task.ticketLink;
      ui.task.ticketContainer.style.display = 'block';
    } else {
      ui.task.ticketContainer.style.display = 'none';
    }
  }
  
  // Счетчик количества
  ui.task.qtyVal.textContent = task.targetQty;
}



// Отправка результата поиска на сервер
async function submitTaskResult(qty) {
  const task = state.filteredTasks[state.currentTaskIndex];
  if (!task) return;
  
  showLoader('Сохранение результата...');
  
  const payload = {
    action: 'submitResult',
    rowIndex: task.rowIndex,
    barcode: task.barcode,
    cell: task.cell,
    foundQty: qty,
    employee: state.employeeFio
  };
  
  try {
    const res = await apiPost(payload);
    if (res.success) {
      showToast('Сохранено!', false);
      advanceTask(false); // Идем дальше
    } else {
      showToast(res.error || 'Не удалось сохранить результат');
    }
  } catch (err) {
    showToast('Сетевая ошибка при сохранении');
  } finally {
    hideLoader();
  }
}

// Переход к следующей задаче
function advanceTask(isSkipped = false) {
  if (isSkipped) {
    showToast('Товар пропущен', false);
  }
  state.currentTaskIndex++;
  renderCurrentTask();
}

// Разблокировка текущей зоны на сервере
async function unlockCurrentZone() {
  if (!state.selectedWarehouse || !state.selectedFloor) return;
  if (state.selectedWarehouse === 'Назначено мне') return; // Блокировка отсутствует в режиме "Назначено мне"
  try {
    await apiPost({
      action: 'unlockZone',
      warehouse: state.selectedWarehouse,
      floor: state.selectedFloor,
      employee: state.employeeFio
    });
  } catch (err) {
    console.error('Ошибка при разблокировке зоны:', err);
  }
}

// Управление модальным окном подтверждения
let pendingSubmitQty = 0;

function showConfirmModal(qty, isFound) {
  const task = state.filteredTasks[state.currentTaskIndex];
  if (!task) return;

  pendingSubmitQty = qty;
  const modalText = document.getElementById('confirmModalText');
  const confirmBtn = document.getElementById('btnConfirmYes');
  const modal = document.getElementById('confirmModal');

  if (!modalText || !confirmBtn || !modal) return;

  if (isFound) {
    modalText.innerHTML = `Вы подтверждаете, что нашли <strong style="color:var(--success-color); font-size:1.15rem;">${qty} шт.</strong> товара в ячейке <strong style="color:#fff; font-size:1.15rem;">${task.cell}</strong>?`;
    confirmBtn.className = 'btn btn-success';
    confirmBtn.textContent = 'Да, подтверждаю';
  } else {
    modalText.innerHTML = `Вы подтверждаете, что товар <strong style="color:var(--danger-color); font-size:1.15rem;">НЕ НАЙДЕН</strong> в ячейке <strong style="color:#fff; font-size:1.15rem;">${task.cell}</strong>?`;
    confirmBtn.className = 'btn btn-danger';
    confirmBtn.textContent = 'Да, не найден';
  }

  modal.style.display = 'flex';
}

function hideConfirmModal() {
  const modal = document.getElementById('confirmModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

// Обновление счетчиков на вкладках складов
function updateWarehouseTabLabels() {
  const fulfillmentCount = state.tasks.filter(t => t.warehouse === 'Фулфилмент' && !t.assignedTo).length;
  const sergeliCount = state.tasks.filter(t => t.warehouse === 'Сергели' && !t.assignedTo).length;
  
  // Для персональных задач ("На мне") фильтруем по совпадению с FIO сотрудника
  const personalCount = state.tasks.filter(t => t.assignedTo && t.assignedTo.trim().toLowerCase() === state.employeeFio.trim().toLowerCase()).length;

  const tabFulfillment = document.getElementById('tabFulfillment');
  const tabSergeli = document.getElementById('tabSergeli');
  const tabPersonal = document.getElementById('tabPersonal');

  if (tabFulfillment) tabFulfillment.textContent = `Фулфилмент (${fulfillmentCount})`;
  if (tabSergeli) tabSergeli.textContent = `Сергели (${sergeliCount})`;
  if (tabPersonal) tabPersonal.textContent = `На мне (${personalCount})`;
}
