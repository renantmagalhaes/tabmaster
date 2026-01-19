document.addEventListener('DOMContentLoaded', function() {
  const searchInput = document.getElementById('search');
  const tabsList = document.getElementById('tabs');
  const bookmarksList = document.getElementById('bookmarks');
  const historyList = document.getElementById('history');
  const closedTabsList = document.getElementById('closed-tabs');
  let currentFocus = -1;

  let tabsData = [];
  let bookmarksData = [];
  let historyData = [];
  let closedTabsData = [];

  const options = {
    keys: ['title', 'url'],
    threshold: 0.3,
    includeScore: true,
    shouldSort: true
  };

  const fuseTabs = new Fuse(tabsData, options);
  const fuseBookmarks = new Fuse(bookmarksData, options);
  const fuseHistory = new Fuse(historyData, options);
  const fuseClosedTabs = new Fuse(closedTabsData, options);

  searchInput.focus();

  function createListItem(item, isTab) {
    const li = document.createElement('li');
    li.style.display = 'block';

    const img = document.createElement('img');
    img.alt = '';
    img.style.width = '16px';
    img.style.height = '16px';
    img.style.marginRight = '8px';
    img.src = (isTab || item.isClosedTab) ? (item.favIconUrl || 'default-favicon.png') : 'default-favicon.png';

    const span = document.createElement('span');
    span.textContent = item.title || item.url;

    li.dataset.url = item.url;
    li.dataset.id = item.id;
    li.appendChild(img);
    li.appendChild(span);

    li.addEventListener('click', () => {
      if (item.isClosedTab) {
        restoreClosedTab(item.id);
      } else if (isTab) {
        switchToTab(parseInt(item.id));
      } else {
        openBookmark(item.url);
      }
    });

    return li;
  }

  function switchToTab(tabId) {
    chrome.tabs.update(tabId, { active: true }, function(tab) {
      chrome.windows.update(tab.windowId, { focused: true });
      window.close();
    });
  }

  function openBookmark(url) {
    chrome.tabs.create({ url }, () => {
      window.close();
    });
  }

  function restoreClosedTab(sessionId) {
    chrome.sessions.restore(sessionId, () => {
      window.close();
    });
  }

  function fetchTabs() {
    chrome.tabs.query({}, function(tabs) {
      tabsData = tabs.map(tab => ({ title: tab.title, url: tab.url, id: tab.id, favIconUrl: tab.favIconUrl }));
      fuseTabs.setCollection(tabsData);
      displayResults(tabsList, tabsData, true);
    });
  }

  function fetchBookmarks() {
    chrome.bookmarks.getTree(function(bookmarkTreeNodes) {
      const flattenBookmarks = (nodes) => {
        let bookmarks = [];
        for (let node of nodes) {
          if (node.url) {
            bookmarks.push({ title: node.title, url: node.url, id: node.id });
          }
          if (node.children) {
            bookmarks = bookmarks.concat(flattenBookmarks(node.children));
          }
        }
        return bookmarks;
      };
      bookmarksData = flattenBookmarks(bookmarkTreeNodes);
      fuseBookmarks.setCollection(bookmarksData);
      displayResults(bookmarksList, bookmarksData, false);
    });
  }

  function fetchHistory(query) {
    chrome.history.search({ text: query, maxResults: 10 }, function(historyItems) {
      historyData = historyItems.map(item => ({ title: item.title, url: item.url, id: item.id }));
      fuseHistory.setCollection(historyData);
      displayResults(historyList, historyData, false);
    });
  }

  function fetchClosedTabs() {
    chrome.sessions.getRecentlyClosed({ maxResults: 10 }, function(sessions) {
      closedTabsData = sessions.filter(session => session.tab).map(session => ({
        title: session.tab.title,
        url: session.tab.url,
        id: session.sessionId,
        favIconUrl: session.tab.favIconUrl,
        isClosedTab: true
      }));
      fuseClosedTabs.setCollection(closedTabsData);
      displayResults(closedTabsList, closedTabsData, false);
    });
  }

  function filterResults(query) {
    const filteredTabs = fuseTabs.search(query).map(result => result.item).slice(0, 10);
    const filteredBookmarks = fuseBookmarks.search(query).map(result => result.item).slice(0, 10);
    const filteredHistory = fuseHistory.search(query).map(result => result.item).slice(0, 10);
    const filteredClosedTabs = fuseClosedTabs.search(query).map(result => result.item).slice(0, 10);

    displayResults(tabsList, filteredTabs, true);
    displayResults(bookmarksList, filteredBookmarks, false);
    displayResults(historyList, filteredHistory, false);
    displayResults(closedTabsList, filteredClosedTabs, false);

    // ✅ Add active to first visible item
    const visibleItems = document.querySelectorAll('#results li:not([style*="display: none"])');
    if (visibleItems.length > 0) {
      currentFocus = 0;
      addActive(visibleItems);
    } else {
      currentFocus = -1;
    }
  }

  function displayResults(list, items, isTab) {
    list.innerHTML = '';
    items.forEach(item => {
      list.appendChild(createListItem(item, isTab));
    });
  }

  searchInput.addEventListener('input', () => {
    const query = searchInput.value;
    if (query) {
      filterResults(query);
    } else {
      fetchTabs();
      fetchBookmarks();
      fetchHistory('');
      fetchClosedTabs();

      setTimeout(selectFirstItem, 50); // optional fallback
    }
  });

  searchInput.addEventListener('keydown', (e) => {
    const visibleItems = document.querySelectorAll('#results li:not([style*="display: none"])');
    if (e.key === 'ArrowDown') {
      currentFocus++;
      addActive(visibleItems);
    } else if (e.key === 'ArrowUp') {
      currentFocus--;
      addActive(visibleItems);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (currentFocus > -1 && visibleItems.length > 0) {
        visibleItems[currentFocus].click();
      } else {
        const query = searchInput.value.trim();
        if (query) {
          handleInputEnter(query);
          window.close();
        }
      }
    }
  });

  function addActive(items) {
    if (!items || items.length === 0) return false;
    removeActive(items);
    if (currentFocus >= items.length) currentFocus = 0;
    if (currentFocus < 0) currentFocus = items.length - 1;
    items[currentFocus].classList.add('active');
    items[currentFocus].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function removeActive(items) {
    for (let i = 0; i < items.length; i++) {
      items[i].classList.remove('active');
    }
  }

  function selectFirstItem() {
    const visibleItems = document.querySelectorAll('#results li');
    if (visibleItems.length > 0) {
      currentFocus = 0;
      addActive(visibleItems);
    }
  }

  fetchTabs();
  fetchBookmarks();
  fetchHistory('');
  fetchClosedTabs();

  function handleInputEnter(query) {
    if (isUrl(query)) {
      let url = query;
      if (!/^https?:\/\//i.test(url)) {
        url = 'https://' + url;
      }
      chrome.tabs.create({ url: url });
    } else {
      chrome.search.query({ text: query, disposition: 'NEW_TAB' });
    }
  }

  function isUrl(string) {
    try {
      new URL(string);
      return true;
    } catch (_) {
      return !/\s/.test(string) && /\./.test(string) && !/^\./.test(string) && !/\.$/.test(string);
    }
  }
  function isUrl(string) {
    try {
      new URL(string);
      return true;
    } catch (_) {
      return !/\s/.test(string) && /\./.test(string) && !/^\./.test(string) && !/\.$/.test(string);
    }
  }

  // --- Settings Logic ---
  const settingsBtn = document.getElementById('settings-btn');
  const settingsPanel = document.getElementById('settings-panel');
  const btnReset = document.getElementById('btn-reset');
  const btnSave = document.getElementById('btn-save');

  const inputs = {
    popupWidth: document.getElementById('set-width'),
    popupHeight: document.getElementById('set-height'),
    fuzziness: document.getElementById('set-fuzziness'),
    bgColor: document.getElementById('set-bg-color'),
    textColor: document.getElementById('set-text-color'),
    accentColor: document.getElementById('set-accent-color'),
    itemBgColor: document.getElementById('set-item-bg-color')
  };

  const displays = {
    popupWidth: document.getElementById('val-width'),
    popupHeight: document.getElementById('val-height'),
    fuzziness: document.getElementById('val-fuzziness')
  };

  const defaultSettings = {
    popupWidth: 600,
    popupHeight: 400,
    fuzziness: 0.3,
    bgColor: '#18181b',
    textColor: '#f4f4f5',
    accentColor: '#3b82f6',
    itemBgColor: '#27272a'
  };

  // Toggle Panel
  settingsBtn.addEventListener('click', () => {
    settingsPanel.classList.toggle('open');
  });

  // Load Settings
  chrome.storage.sync.get(defaultSettings, (settings) => {
    applySettings(settings);
    updateInputs(settings);
  });

  // Apply Changes Live (Preview)
  Object.keys(inputs).forEach(key => {
    // 1. Live Preview on 'input'
    inputs[key].addEventListener('input', (e) => {
      const value = e.target.value;
      
      // Update display text
      if (displays[key]) {
        displays[key].textContent = value + (key.includes('fuzziness') ? '' : 'px');
      }
      
      // Apply visually (CSS or runtime options)
      const previewSettings = {};
      if (key === 'popupWidth' || key === 'popupHeight') {
        previewSettings[key] = parseInt(value);
      } else if (key === 'fuzziness') {
        previewSettings[key] = parseFloat(value);
      } else {
        previewSettings[key] = value;
      }
      
      applySettings(previewSettings);

      // Re-init Fuse if fuzziness changed (for live search preview)
      if (key === 'fuzziness') {
        options.threshold = parseFloat(value);
        fuseTabs.options.threshold = options.threshold;
        fuseBookmarks.options.threshold = options.threshold;
        fuseHistory.options.threshold = options.threshold;
        fuseClosedTabs.options.threshold = options.threshold;
        
        if (searchInput.value) filterResults(searchInput.value);
      }
    });

    // 2. Save on 'change' (Commit) - Prevents Quota Error
    inputs[key].addEventListener('change', (e) => {
      const value = e.target.value;
      const newSettings = {};
      
      if (key === 'popupWidth' || key === 'popupHeight') {
        newSettings[key] = parseInt(value);
      } else if (key === 'fuzziness') {
        newSettings[key] = parseFloat(value);
      } else {
        newSettings[key] = value;
      }

      chrome.storage.sync.set(newSettings);
    });
  });

  // Save (Close)
  btnSave.addEventListener('click', () => {
    settingsPanel.classList.remove('open');
  });

  // Reset
  btnReset.addEventListener('click', () => {
    chrome.storage.sync.set(defaultSettings, () => {
      applySettings(defaultSettings);
      updateInputs(defaultSettings);
    });
  });

  function applySettings(s) {
    const root = document.documentElement;
    if (s.popupWidth) root.style.setProperty('--popup-width', s.popupWidth + 'px');
    if (s.popupHeight) root.style.setProperty('--popup-height', s.popupHeight + 'px');
    if (s.bgColor) root.style.setProperty('--bg-color', s.bgColor);
    if (s.textColor) root.style.setProperty('--text-color', s.textColor);
    if (s.accentColor) root.style.setProperty('--accent-color', s.accentColor);
    if (s.itemBgColor) root.style.setProperty('--item-bg-color', s.itemBgColor);
    
    if (s.fuzziness !== undefined) {
      options.threshold = s.fuzziness;
    }
  }

  function updateInputs(s) {
    inputs.popupWidth.value = s.popupWidth;
    displays.popupWidth.textContent = s.popupWidth + 'px';
    
    if (s.popupHeight) {
      inputs.popupHeight.value = s.popupHeight;
      displays.popupHeight.textContent = s.popupHeight + 'px';
    }

    inputs.fuzziness.value = s.fuzziness;
    displays.fuzziness.textContent = s.fuzziness;
    
    inputs.bgColor.value = s.bgColor;
    inputs.textColor.value = s.textColor;
    inputs.accentColor.value = s.accentColor;
    inputs.itemBgColor.value = s.itemBgColor;
  }
});
