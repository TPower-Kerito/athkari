/**
 * أذكاري - تطبيق أذكار الصباح والمساء والسبحة
 * منطق التطبيق الكامل والتخزين المحلي وإدارة الحالة
 */

(function () {
  'use strict';

  // --- Storage Keys ---
  const STORAGE_KEYS = {
    SETTINGS: 'athkari_settings',
    PROGRESS: 'athkari_daily_progress',
    STATS: 'athkari_stats',
    TASBEEH: 'athkari_tasbeeh_state'
  };

  // --- Audio Synthesizer (Web Audio API) ---
  let audioCtx = null;
  function getAudioContext() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  }

  function playTone(freq, duration, type = 'sine', gainVal = 0.15) {
    if (!state.settings.soundEnabled) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);

      gain.gain.setValueAtTime(gainVal, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch (e) {
      // Audio not permitted yet or failed
    }
  }

  function playTapSound() {
    playTone(600, 0.06, 'triangle', 0.12);
  }

  function playCompleteSound() {
    playTone(523.25, 0.12, 'sine', 0.15); // C5
    setTimeout(() => {
      playTone(659.25, 0.22, 'sine', 0.2); // E5
    }, 110);
  }

  // --- Haptics (Vibration API) ---
  function triggerHaptic(type = 'tap') {
    if (!state.settings.hapticsEnabled || !('vibrate' in navigator)) return;
    try {
      if (type === 'tap') {
        navigator.vibrate(30);
      } else if (type === 'complete') {
        navigator.vibrate([40, 50, 90]);
      } else if (type === 'cycle') {
        navigator.vibrate([70, 60, 140]);
      }
    } catch (e) {
      // Ignore vibration error
    }
  }

  // --- Date Utility ---
  function getTodayString() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // --- Application State ---
  const state = {
    currentTab: 'morning',
    filter: 'all',
    todayDate: getTodayString(),
    settings: {
      theme: 'dark',
      colorTheme: 'emerald',
      devMode: false,
      customColors: null,
      fontScale: 1.0,
      hapticsEnabled: true,
      soundEnabled: true
    },
    // Daily progress of counts remaining
    progress: {
      date: getTodayString(),
      morning: {},
      evening: {}
    },
    // Lifetime Stats
    stats: {
      currentStreak: 0,
      bestStreak: 0,
      lastCompletedDate: null,
      morningCount: 0,
      eveningCount: 0,
      totalTasbeeh: 0,
      history: {} // { 'YYYY-MM-DD': { morning: bool, evening: bool, tasbeeh: number } }
    },
    // Tasbeeh
    tasbeeh: {
      presetIndex: 0,
      count: 0,
      rounds: 0,
      todayTotal: 0
    }
  };

  // --- LocalStorage Helpers ---
  function loadFromStorage() {
    try {
      const savedSettings = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (savedSettings) state.settings = { ...state.settings, ...JSON.parse(savedSettings) };

      const savedStats = localStorage.getItem(STORAGE_KEYS.STATS);
      if (savedStats) state.stats = { ...state.stats, ...JSON.parse(savedStats) };

      const savedTasbeeh = localStorage.getItem(STORAGE_KEYS.TASBEEH);
      if (savedTasbeeh) state.tasbeeh = { ...state.tasbeeh, ...JSON.parse(savedTasbeeh) };

      const savedProgress = localStorage.getItem(STORAGE_KEYS.PROGRESS);
      const today = getTodayString();
      if (savedProgress) {
        const parsed = JSON.parse(savedProgress);
        if (parsed.date === today) {
          state.progress = parsed;
        } else {
          // New day detected! Initialize fresh daily progress
          initFreshDay(today);
        }
      } else {
        initFreshDay(today);
      }
    } catch (err) {
      console.error('Failed to load storage:', err);
      initFreshDay(getTodayString());
    }

    updateStreakStatus();
  }

  function initFreshDay(today) {
    state.progress = {
      date: today,
      morning: {},
      evening: {}
    };

    ATHKAR_DATA.morning.forEach(item => {
      state.progress.morning[item.id] = item.count;
    });

    ATHKAR_DATA.evening.forEach(item => {
      state.progress.evening[item.id] = item.count;
    });

    // Reset daily tasbeeh total count if date changed
    state.tasbeeh.todayTotal = 0;
    state.tasbeeh.count = 0;
    state.tasbeeh.rounds = 0;

    saveProgress();
    saveTasbeeh();
  }

  function saveSettings() {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(state.settings));
  }

  function saveProgress() {
    localStorage.setItem(STORAGE_KEYS.PROGRESS, JSON.stringify(state.progress));
  }

  function saveStats() {
    localStorage.setItem(STORAGE_KEYS.STATS, JSON.stringify(state.stats));
  }

  function saveTasbeeh() {
    localStorage.setItem(STORAGE_KEYS.TASBEEH, JSON.stringify(state.tasbeeh));
  }

  // --- Streak & Progress Calculations ---
  function updateStreakStatus() {
    const today = getTodayString();
    const history = state.stats.history || {};

    // Check yesterday
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const yesterday = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const doneToday = history[today] && (history[today].morning || history[today].evening);
    const doneYesterday = history[yesterday] && (history[yesterday].morning || history[yesterday].evening);

    if (!doneToday && !doneYesterday && state.stats.currentStreak > 0) {
      // Streak broken
      if (state.stats.lastCompletedDate !== today && state.stats.lastCompletedDate !== yesterday) {
        state.stats.currentStreak = 0;
        saveStats();
      }
    }
  }

  function checkSessionCompletion(type) {
    const list = ATHKAR_DATA[type];
    const isAllComplete = list.every(item => (state.progress[type][item.id] || 0) === 0);

    const today = getTodayString();
    if (!state.stats.history[today]) {
      state.stats.history[today] = { morning: false, evening: false, tasbeeh: 0 };
    }

    if (isAllComplete && !state.stats.history[today][type]) {
      // First time completing this section today!
      state.stats.history[today][type] = true;
      if (type === 'morning') state.stats.morningCount++;
      if (type === 'evening') state.stats.eveningCount++;

      // Update streak if this was the trigger for today
      if (state.stats.lastCompletedDate !== today) {
        state.stats.currentStreak++;
        if (state.stats.currentStreak > state.stats.bestStreak) {
          state.stats.bestStreak = state.stats.currentStreak;
        }
        state.stats.lastCompletedDate = today;
      }

      saveStats();
      updateStatsUI();
      renderStreakBadge();
    }

    return isAllComplete;
  }

  // --- DOM Elements ---
  const els = {
    body: document.body,
    streakBadge: document.getElementById('streakBadge'),
    streakCount: document.getElementById('streakCount'),
    settingsBtn: document.getElementById('settingsBtn'),
    settingsToolbar: document.getElementById('settingsToolbar'),
    themeToggleBtn: document.getElementById('themeToggleBtn'),
    fontDecBtn: document.getElementById('fontDecBtn'),
    fontIncBtn: document.getElementById('fontIncBtn'),
    fontScaleDisplay: document.getElementById('fontScaleDisplay'),
    hapticToggleBtn: document.getElementById('hapticToggleBtn'),
    soundToggleBtn: document.getElementById('soundToggleBtn'),
    tabBtns: document.querySelectorAll('.tab-btn'),
    athkarSection: document.getElementById('athkarSection'),
    tasbeehSection: document.getElementById('tasbeehSection'),
    statsSection: document.getElementById('statsSection'),
    progressTitle: document.getElementById('progressTitle'),
    progressRatio: document.getElementById('progressRatio'),
    progressPercent: document.getElementById('progressPercent'),
    progressBarFill: document.getElementById('progressBarFill'),
    completionMessage: document.getElementById('completionMessage'),
    resetSectionBtn: document.getElementById('resetSectionBtn'),
    filterChips: document.querySelectorAll('.filter-chips .chip'),
    athkarList: document.getElementById('athkarList'),
    // Tasbeeh
    tasbeehPresets: document.getElementById('tasbeehPresets'),
    tasbeehActiveText: document.getElementById('tasbeehActiveText'),
    tasbeehTarget: document.getElementById('tasbeehTarget'),
    tasbeehTapBtn: document.getElementById('tasbeehTapBtn'),
    tasbeehCount: document.getElementById('tasbeehCount'),
    tasbeehProgressRing: document.getElementById('tasbeehProgressRing'),
    tasbeehRounds: document.getElementById('tasbeehRounds'),
    tasbeehTotal: document.getElementById('tasbeehTotal'),
    tasbeehResetRoundBtn: document.getElementById('tasbeehResetRoundBtn'),
    tasbeehResetAllBtn: document.getElementById('tasbeehResetAllBtn'),
    // Stats
    statsCurrentStreak: document.getElementById('statsCurrentStreak'),
    statsBestStreak: document.getElementById('statsBestStreak'),
    statsMorningCount: document.getElementById('statsMorningCount'),
    statsEveningCount: document.getElementById('statsEveningCount'),
    statsTotalTasbeehCount: document.getElementById('statsTotalTasbeehCount'),
    statsActiveDays: document.getElementById('statsActiveDays'),
    weekTracker: document.getElementById('weekTracker'),
    // Modal
    confirmModal: document.getElementById('confirmModal'),
    modalConfirmBtn: document.getElementById('modalConfirmBtn'),
    modalCancelBtn: document.getElementById('modalCancelBtn'),
    // Update Banner
    updateBanner: document.getElementById('updateNotificationBanner'),
    applyUpdateBtn: document.getElementById('applyUpdateBtn'),
    updateChangelog: document.getElementById('updateChangelog'),
    // Developer Options
    devUnlockBtn: document.getElementById('devUnlockBtn'),
    devOptionsContainer: document.getElementById('devOptionsContainer'),
    devLockBtn: document.getElementById('devLockBtn'),
    devAccentColor: document.getElementById('devAccentColor'),
    devAccentHex: document.getElementById('devAccentHex'),
    devBgColor: document.getElementById('devBgColor'),
    devBgHex: document.getElementById('devBgHex'),
    devCardColor: document.getElementById('devCardColor'),
    devCardHex: document.getElementById('devCardHex'),
    devTextColor: document.getElementById('devTextColor'),
    devTextHex: document.getElementById('devTextHex'),
    devApplyColorsBtn: document.getElementById('devApplyColorsBtn'),
    devResetColorsBtn: document.getElementById('devResetColorsBtn'),
    toastMessage: document.getElementById('toastMessage')
  };

  // --- Rendering UI ---
  function applySettings() {
    // Theme
    if (state.settings.theme === 'light') {
      els.body.classList.remove('theme-dark');
      els.body.classList.add('theme-light');
      document.querySelector('meta[name="theme-color"]').setAttribute('content', '#f4f7f5');
    } else {
      els.body.classList.remove('theme-light');
      els.body.classList.add('theme-dark');
      document.querySelector('meta[name="theme-color"]').setAttribute('content', '#0a281e');
    }

    // Font Scale
    document.documentElement.style.setProperty('--font-scale', state.settings.fontScale);
    els.fontScaleDisplay.textContent = Math.round(state.settings.fontScale * 100) + '%';

    // Color Theme Palette
    const colorTheme = state.settings.colorTheme || 'emerald';
    els.body.classList.remove('color-emerald', 'color-blue', 'color-purple', 'color-amber', 'color-rose');
    els.body.classList.add(`color-${colorTheme}`);

    // Update active color swatch in UI
    document.querySelectorAll('.color-swatch-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-color') === colorTheme);
    });

    // Developer Mode Visibility
    if (els.devOptionsContainer) {
      els.devOptionsContainer.classList.toggle('hidden', !state.settings.devMode);
    }

    // Apply or Reset Custom Developer Colors
    if (state.settings.customColors) {
      const c = state.settings.customColors;
      document.documentElement.style.setProperty('--accent-emerald', c.accent);
      document.documentElement.style.setProperty('--accent-emerald-dark', c.accent);
      document.documentElement.style.setProperty('--accent-emerald-light', c.accent);
      document.documentElement.style.setProperty('--border-focus', c.accent);
      document.documentElement.style.setProperty('--bg-app', c.bg);
      document.documentElement.style.setProperty('--bg-surface', c.card);
      document.documentElement.style.setProperty('--bg-surface-card', c.card);
      document.documentElement.style.setProperty('--text-dhikr', c.text);

      if (els.devAccentColor) els.devAccentColor.value = c.accent;
      if (els.devAccentHex) els.devAccentHex.textContent = c.accent;
      if (els.devBgColor) els.devBgColor.value = c.bg;
      if (els.devBgHex) els.devBgHex.textContent = c.bg;
      if (els.devCardColor) els.devCardColor.value = c.card;
      if (els.devCardHex) els.devCardHex.textContent = c.card;
      if (els.devTextColor) els.devTextColor.value = c.text;
      if (els.devTextHex) els.devTextHex.textContent = c.text;
    } else {
      // Remove inline style overrides so normal themes work
      document.documentElement.style.removeProperty('--accent-emerald');
      document.documentElement.style.removeProperty('--accent-emerald-dark');
      document.documentElement.style.removeProperty('--accent-emerald-light');
      document.documentElement.style.removeProperty('--border-focus');
      document.documentElement.style.removeProperty('--bg-app');
      document.documentElement.style.removeProperty('--bg-surface');
      document.documentElement.style.removeProperty('--bg-surface-card');
      document.documentElement.style.removeProperty('--text-dhikr');
    }

    // Toggle states
    els.hapticToggleBtn.classList.toggle('active', state.settings.hapticsEnabled);
    els.soundToggleBtn.classList.toggle('active', state.settings.soundEnabled);
  }

  function renderStreakBadge() {
    els.streakCount.textContent = state.stats.currentStreak;
  }

  function renderProgressBar() {
    if (state.currentTab !== 'morning' && state.currentTab !== 'evening') return;

    const type = state.currentTab;
    const items = ATHKAR_DATA[type];
    const totalItems = items.length;

    let completedItemsCount = 0;
    items.forEach(item => {
      const remaining = state.progress[type][item.id] !== undefined ? state.progress[type][item.id] : item.count;
      if (remaining <= 0) completedItemsCount++;
    });

    const percent = Math.round((completedItemsCount / totalItems) * 100);

    els.progressTitle.textContent = type === 'morning' ? 'أذكار الصباح' : 'أذكار المساء';
    els.progressRatio.textContent = `${completedItemsCount} / ${totalItems}`;
    els.progressPercent.textContent = `${percent}%`;
    els.progressBarFill.style.width = `${percent}%`;

    const isComplete = completedItemsCount === totalItems;
    els.completionMessage.classList.toggle('hidden', !isComplete);
  }

  function renderAthkarList() {
    if (state.currentTab !== 'morning' && state.currentTab !== 'evening') return;

    const type = state.currentTab;
    const list = ATHKAR_DATA[type];
    els.athkarList.innerHTML = '';

    list.forEach((item, index) => {
      const remaining = state.progress[type][item.id] !== undefined ? state.progress[type][item.id] : item.count;
      const isCompleted = remaining <= 0;

      // Filter check
      if (state.filter === 'remaining' && isCompleted) return;
      if (state.filter === 'completed' && !isCompleted) return;

      const card = document.createElement('article');
      card.className = `dhikr-card ${isCompleted ? 'completed' : ''}`;
      card.id = `card-${item.id}`;

      card.innerHTML = `
        <div class="dhikr-header">
          <span class="dhikr-badge">${item.category}</span>
          <span class="dhikr-title">${item.title}</span>
        </div>
        <div class="dhikr-text-container">
          <p class="dhikr-arabic-text">${item.text.replace(/\n/g, '<br>')}</p>
        </div>
        ${item.virtue ? `
          <div class="dhikr-virtue">
            <strong>الفضل: </strong>${item.virtue}
          </div>
        ` : ''}
        <div class="dhikr-footer">
          <div class="dhikr-status-label">
            ${isCompleted ? '<span>تم بحمد الله ✓</span>' : `<span>العدد المطلوب: <strong>${item.count}</strong></span>`}
          </div>
          <button class="dhikr-counter-btn" data-id="${item.id}" aria-label="تسبيح: ${item.title}">
            <span class="btn-counter-val">${isCompleted ? '✓' : remaining}</span>
            <span class="btn-counter-sub">${isCompleted ? 'مكتمل' : 'متبقي'}</span>
          </button>
        </div>
      `;

      // Counter button click handler
      const counterBtn = card.querySelector('.dhikr-counter-btn');
      counterBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleDhikrTap(type, item.id, item.count);
      });

      // Clicking anywhere on card also triggers counter if not completed
      card.addEventListener('click', (e) => {
        // Prevent accidental trigger on text selection
        if (window.getSelection().toString().length > 0) return;
        if (!isCompleted) {
          handleDhikrTap(type, item.id, item.count);
        }
      });

      els.athkarList.appendChild(card);
    });
  }

  function handleDhikrTap(type, id, totalCount) {
    let rem = state.progress[type][id] !== undefined ? state.progress[type][id] : totalCount;

    if (rem > 0) {
      rem--;
      state.progress[type][id] = rem;
      saveProgress();

      if (rem === 0) {
        // Just completed this Dhikr
        playCompleteSound();
        triggerHaptic('complete');
        const isSessionFinished = checkSessionCompletion(type);
        renderProgressBar();
        renderAthkarList();

        // If completed, smooth scroll to next incomplete card
        if (!isSessionFinished) {
          const nextCard = document.querySelector('.dhikr-card:not(.completed)');
          if (nextCard) {
            nextCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }
      } else {
        // Regular tap
        playTapSound();
        triggerHaptic('tap');
        renderProgressBar();
        
        // Update just the card UI quickly without full redraw
        const card = document.getElementById(`card-${id}`);
        if (card) {
          const valEl = card.querySelector('.btn-counter-val');
          if (valEl) valEl.textContent = rem;
        }
      }
    } else {
      // Already completed - gentle reminder sound
      playTapSound();
      triggerHaptic('tap');
    }
  }

  // --- Tasbeeh Logic ---
  function initTasbeehPresets() {
    els.tasbeehPresets.innerHTML = '';
    ATHKAR_DATA.tasbeeh.forEach((preset, index) => {
      const chip = document.createElement('button');
      chip.className = `preset-chip ${index === state.tasbeeh.presetIndex ? 'active' : ''}`;
      chip.textContent = preset.text;
      chip.addEventListener('click', () => {
        state.tasbeeh.presetIndex = index;
        state.tasbeeh.count = 0;
        state.tasbeeh.rounds = 0;
        saveTasbeeh();
        renderTasbeeh();
        playTapSound();
        triggerHaptic('tap');
      });
      els.tasbeehPresets.appendChild(chip);
    });
  }

  function renderTasbeeh() {
    const currentPreset = ATHKAR_DATA.tasbeeh[state.tasbeeh.presetIndex] || ATHKAR_DATA.tasbeeh[0];
    els.tasbeehActiveText.textContent = currentPreset.text;
    els.tasbeehTarget.textContent = currentPreset.target;
    els.tasbeehCount.textContent = state.tasbeeh.count;
    els.tasbeehRounds.textContent = state.tasbeeh.rounds;
    els.tasbeehTotal.textContent = state.tasbeeh.todayTotal;

    // Update SVG Ring Progress
    const target = currentPreset.target || 33;
    const perimeter = 2 * Math.PI * 90; // ~565.48
    const progress = Math.min(state.tasbeeh.count / target, 1);
    const offset = perimeter - (progress * perimeter);
    els.tasbeehProgressRing.style.strokeDashoffset = offset;

    // Update active preset chip
    const chips = els.tasbeehPresets.querySelectorAll('.preset-chip');
    chips.forEach((c, idx) => {
      c.classList.toggle('active', idx === state.tasbeeh.presetIndex);
    });
  }

  function handleTasbeehTap() {
    const currentPreset = ATHKAR_DATA.tasbeeh[state.tasbeeh.presetIndex] || ATHKAR_DATA.tasbeeh[0];
    const target = currentPreset.target || 33;

    state.tasbeeh.count++;
    state.tasbeeh.todayTotal++;
    state.stats.totalTasbeeh++;

    const today = getTodayString();
    if (!state.stats.history[today]) {
      state.stats.history[today] = { morning: false, evening: false, tasbeeh: 0 };
    }
    state.stats.history[today].tasbeeh = (state.stats.history[today].tasbeeh || 0) + 1;

    if (state.tasbeeh.count >= target) {
      // Completed round/cycle
      state.tasbeeh.count = 0;
      state.tasbeeh.rounds++;
      playCompleteSound();
      triggerHaptic('cycle');
    } else {
      playTapSound();
      triggerHaptic('tap');
    }

    saveTasbeeh();
    saveStats();
    renderTasbeeh();
  }

  // --- Statistics Logic ---
  function updateStatsUI() {
    els.statsCurrentStreak.textContent = state.stats.currentStreak;
    els.statsBestStreak.textContent = state.stats.bestStreak;
    els.statsMorningCount.textContent = state.stats.morningCount;
    els.statsEveningCount.textContent = state.stats.eveningCount;
    els.statsTotalTasbeehCount.textContent = state.stats.totalTasbeeh;

    const history = state.stats.history || {};
    const activeDaysCount = Object.keys(history).length;
    els.statsActiveDays.textContent = activeDaysCount;

    // Render Week Tracker (Last 7 Days)
    els.weekTracker.innerHTML = '';
    const dayNames = ['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'];

    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const dayName = dayNames[d.getDay()];
      const dayData = history[dateStr];
      const isDone = dayData && (dayData.morning || dayData.evening);

      const col = document.createElement('div');
      col.className = 'day-col';
      col.innerHTML = `
        <div class="day-badge ${isDone ? 'done' : ''}">${isDone ? '✓' : d.getDate()}</div>
        <span class="day-name">${dayName}</span>
      `;
      els.weekTracker.appendChild(col);
    }
  }

  // --- Navigation & Tabs ---
  function switchTab(targetTab) {
    state.currentTab = targetTab;

    els.tabBtns.forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === targetTab);
    });

    els.athkarSection.classList.toggle('active', targetTab === 'morning' || targetTab === 'evening');
    els.tasbeehSection.classList.toggle('active', targetTab === 'tasbeeh');
    els.statsSection.classList.toggle('active', targetTab === 'stats');

    if (targetTab === 'morning' || targetTab === 'evening') {
      renderProgressBar();
      renderAthkarList();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (targetTab === 'tasbeeh') {
      renderTasbeeh();
    } else if (targetTab === 'stats') {
      updateStatsUI();
    }
  }

  // --- Reset Modal ---
  function showResetModal() {
    els.confirmModal.classList.remove('hidden');
  }

  function hideResetModal() {
    els.confirmModal.classList.add('hidden');
  }

  function executeSectionReset() {
    const type = state.currentTab;
    if (type !== 'morning' && type !== 'evening') return;

    ATHKAR_DATA[type].forEach(item => {
      state.progress[type][item.id] = item.count;
    });

    saveProgress();
    renderProgressBar();
    renderAthkarList();
    hideResetModal();
    playTapSound();
  }

  // --- Setup Event Listeners ---
  function setupEventListeners() {
    // Header Greeting according to time of day
    const hour = new Date().getHours();
    const greetingEl = document.getElementById('headerGreeting');
    if (greetingEl) {
      if (hour >= 4 && hour < 14) {
        greetingEl.textContent = 'أَصْبَحْنَا وَأَصْبَحَ الْمُلْكُ لِلَّهِ ☀️';
      } else {
        greetingEl.textContent = 'أَمْسَيْنَا وَأَمْسَى الْمُلْكُ لِلَّهِ 🌙';
      }
    }

    // Default tab based on current time (morning before 2 PM, evening after 2 PM)
    if (hour >= 4 && hour < 14) {
      state.currentTab = 'morning';
    } else {
      state.currentTab = 'evening';
    }

    // Settings Toggle
    els.settingsBtn.addEventListener('click', () => {
      els.settingsToolbar.classList.toggle('hidden');
    });

    // Color Swatch Selection
    document.querySelectorAll('.color-swatch-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const selectedColor = btn.getAttribute('data-color');
        state.settings.colorTheme = selectedColor;
        saveSettings();
        applySettings();
        triggerHaptic('tap');
      });
    });

    // Theme Toggle
    els.themeToggleBtn.addEventListener('click', () => {
      state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark';
      saveSettings();
      applySettings();
    });

    // Font Size Controls
    els.fontIncBtn.addEventListener('click', () => {
      if (state.settings.fontScale < 1.4) {
        state.settings.fontScale = +(state.settings.fontScale + 0.08).toFixed(2);
        saveSettings();
        applySettings();
      }
    });

    els.fontDecBtn.addEventListener('click', () => {
      if (state.settings.fontScale > 0.85) {
        state.settings.fontScale = +(state.settings.fontScale - 0.08).toFixed(2);
        saveSettings();
        applySettings();
      }
    });

    // Haptics & Sound Toggles
    els.hapticToggleBtn.addEventListener('click', () => {
      state.settings.hapticsEnabled = !state.settings.hapticsEnabled;
      saveSettings();
      applySettings();
      triggerHaptic('tap');
    });

    els.soundToggleBtn.addEventListener('click', () => {
      state.settings.soundEnabled = !state.settings.soundEnabled;
      saveSettings();
      applySettings();
      if (state.settings.soundEnabled) playTapSound();
    });

    // Tabs
    els.tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        switchTab(tab);
      });
    });

    // Filters
    els.filterChips.forEach(chip => {
      chip.addEventListener('click', () => {
        els.filterChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        state.filter = chip.getAttribute('data-filter');
        renderAthkarList();
      });
    });

    // Reset Section Link
    els.resetSectionBtn.addEventListener('click', showResetModal);
    els.modalCancelBtn.addEventListener('click', hideResetModal);
    els.modalConfirmBtn.addEventListener('click', executeSectionReset);

    // Tasbeeh Controls
    els.tasbeehTapBtn.addEventListener('click', handleTasbeehTap);

    els.tasbeehResetRoundBtn.addEventListener('click', () => {
      state.tasbeeh.count = 0;
      saveTasbeeh();
      renderTasbeeh();
      playTapSound();
    });

    els.tasbeehResetAllBtn.addEventListener('click', () => {
      state.tasbeeh.count = 0;
      state.tasbeeh.rounds = 0;
      state.tasbeeh.todayTotal = 0;
      saveTasbeeh();
      renderTasbeeh();
      playTapSound();
    });

    // Toast Helper
    let toastTimer = null;
    function showToast(msg) {
      if (!els.toastMessage) return;
      els.toastMessage.textContent = msg;
      els.toastMessage.classList.remove('hidden');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        els.toastMessage.classList.add('hidden');
      }, 2500);
    }

    // Developer 7-Taps Unlock Mechanism
    let devTapCount = 0;
    let devTapTimer = null;
    if (els.devUnlockBtn) {
      els.devUnlockBtn.addEventListener('click', () => {
        if (state.settings.devMode) {
          showToast('خيارات المطور مفعلة بالفعل 🛠️');
          return;
        }

        devTapCount++;
        clearTimeout(devTapTimer);
        devTapTimer = setTimeout(() => {
          devTapCount = 0;
        }, 3000);

        const remaining = 7 - devTapCount;
        if (remaining > 0 && remaining <= 4) {
          showToast(`تبقى ${remaining} ضغطات لتصبح مطوراً 🛠️`);
          triggerHaptic('tap');
        } else if (remaining <= 0) {
          state.settings.devMode = true;
          devTapCount = 0;
          saveSettings();
          applySettings();
          showToast('تم تفعيل خيارات المطور بنجاح! 🛠️🎉');
          triggerHaptic('cycle');
          playCompleteSound();
        } else {
          triggerHaptic('tap');
        }
      });
    }

    // Developer Lock Button
    if (els.devLockBtn) {
      els.devLockBtn.addEventListener('click', () => {
        state.settings.devMode = false;
        saveSettings();
        applySettings();
        showToast('تم قفل خيارات المطور 🔒');
        triggerHaptic('tap');
      });
    }

    // Developer Color Pickers Live Hex Sync
    const bindColorPicker = (inputEl, hexEl) => {
      if (inputEl && hexEl) {
        inputEl.addEventListener('input', () => {
          hexEl.textContent = inputEl.value;
        });
      }
    };
    bindColorPicker(els.devAccentColor, els.devAccentHex);
    bindColorPicker(els.devBgColor, els.devBgHex);
    bindColorPicker(els.devCardColor, els.devCardHex);
    bindColorPicker(els.devTextColor, els.devTextHex);

    // Apply Custom Developer Colors
    if (els.devApplyColorsBtn) {
      els.devApplyColorsBtn.addEventListener('click', () => {
        state.settings.customColors = {
          accent: els.devAccentColor.value,
          bg: els.devBgColor.value,
          card: els.devCardColor.value,
          text: els.devTextColor.value
        };
        saveSettings();
        applySettings();
        showToast('تم تطبيق الألوان المخصصة بالكامل! 🎨');
        triggerHaptic('cycle');
        playCompleteSound();
      });
    }

    // Reset Custom Developer Colors
    if (els.devResetColorsBtn) {
      els.devResetColorsBtn.addEventListener('click', () => {
        state.settings.customColors = null;
        saveSettings();
        applySettings();
        showToast('تمت استعادة الألوان الافتراضية 🌿');
        triggerHaptic('tap');
      });
    }

    // Check for App Updates (Over-The-Air)
    checkForAppUpdates();
  }

  // --- Over-The-Air (OTA) In-App Auto Update System ---
  async function checkForAppUpdates() {
    try {
      // 1. Fetch remote version.json with cache buster
      const res = await fetch(`version.json?_t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return;

      const remoteData = await res.json();
      const storedBuild = localStorage.getItem('athkari_app_build');

      // On first launch, record baseline version without showing an update notification
      if (!storedBuild) {
        localStorage.setItem('athkari_app_build', remoteData.build);
        return;
      }

      const currentBuild = parseInt(storedBuild, 10);

      // Only show update notification if remote build is strictly newer
      if (remoteData.build > currentBuild) {
        if (els.updateChangelog && remoteData.changelog) {
          els.updateChangelog.textContent = `الإصدار ${remoteData.version}: ${remoteData.changelog}`;
        }
        if (els.updateBanner) {
          els.updateBanner.classList.remove('hidden');
        }

        if (els.applyUpdateBtn) {
          els.applyUpdateBtn.addEventListener('click', async () => {
            els.applyUpdateBtn.textContent = 'جاري التحديث...';
            els.applyUpdateBtn.disabled = true;

            // Save new build number
            localStorage.setItem('athkari_app_build', remoteData.build);

            // Clean service worker caches
            if ('caches' in window) {
              try {
                const keys = await caches.keys();
                await Promise.all(keys.map(k => caches.delete(k)));
              } catch (e) {
                console.warn('Cache clearing error:', e);
              }
            }

            // Update service worker
            if ('serviceWorker' in navigator) {
              try {
                const regs = await navigator.serviceWorker.getRegistrations();
                for (let r of regs) {
                  await r.update();
                }
              } catch (e) {
                console.warn('SW update error:', e);
              }
            }

            // Refresh window cleanly
            setTimeout(() => {
              window.location.reload(true);
            }, 400);
          });
        }
      }
    } catch (e) {
      // Offline or network error - silently skip
    }
  }

  // --- Initialize App ---
  function init() {
    loadFromStorage();
    applySettings();
    renderStreakBadge();
    setupEventListeners();
    initTasbeehPresets();
    switchTab(state.currentTab);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
