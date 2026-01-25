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
  
  // Track if data has been loaded (for lazy loading)
  let historyLoaded = false;
  let closedTabsLoaded = false;
  
  // Debounce timer for search input
  let searchDebounceTimer = null;
  
  // Maximum data size limits for memory management
  const MAX_HISTORY_ITEMS = 5000;
  const MAX_CLOSED_TABS_ITEMS = 500;

  const options = {
    keys: ['title', 'url', 'combined'],
    threshold: 0.3,
    includeScore: true,
    shouldSort: true,
    useExtendedSearch: true,
    ignoreLocation: true,  // Don't penalize matches based on position
    distance: 1000  // Allow matches far apart in the combined string
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
    if (isTab || item.isClosedTab) {
      img.src = item.favIconUrl || 'default-favicon.png';
    } else if (item.url) {
      // For bookmarks and history, use Google's favicon service (works in Manifest V3)
      try {
        const url = new URL(item.url);
        // Check if it's a standard http/https URL with a hostname
        if (url.hostname && (url.protocol === 'http:' || url.protocol === 'https:')) {
          // Use Google's favicon service which works reliably
          img.src = 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(url.hostname) + '&sz=16';
        } else {
          // For non-standard URLs (like vivaldi://, chrome://, etc.), use default
          img.src = 'default-favicon.png';
        }
      } catch (e) {
        // Fallback if URL parsing fails (e.g., invalid URLs)
        img.src = 'default-favicon.png';
      }
      // Add error handler as fallback
      img.onerror = function() {
        this.src = 'default-favicon.png';
      };
    } else {
      img.src = 'default-favicon.png';
    }

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
    try {
      chrome.tabs.update(tabId, { active: true }, function(tab) {
        if (chrome.runtime.lastError) {
          console.error('Error switching to tab:', chrome.runtime.lastError.message);
          return;
        }
        if (tab) {
          chrome.windows.update(tab.windowId, { focused: true }, function() {
            if (chrome.runtime.lastError) {
              console.error('Error focusing window:', chrome.runtime.lastError.message);
            }
            window.close();
          });
        }
      });
    } catch (error) {
      console.error('Error in switchToTab:', error);
    }
  }

  function openBookmark(url) {
    try {
      chrome.tabs.create({ url }, () => {
        if (chrome.runtime.lastError) {
          console.error('Error opening bookmark:', chrome.runtime.lastError.message);
          return;
        }
        window.close();
      });
    } catch (error) {
      console.error('Error in openBookmark:', error);
    }
  }

  function restoreClosedTab(sessionId) {
    try {
      chrome.sessions.restore(sessionId, () => {
        if (chrome.runtime.lastError) {
          console.error('Error restoring closed tab:', chrome.runtime.lastError.message);
          return;
        }
        window.close();
      });
    } catch (error) {
      console.error('Error in restoreClosedTab:', error);
    }
  }

  function fetchTabs() {
    try {
      chrome.tabs.query({}, function(tabs) {
        if (chrome.runtime.lastError) {
          console.error('Error fetching tabs:', chrome.runtime.lastError.message);
          return;
        }
        tabsData = tabs.map(tab => ({ 
          title: tab.title, 
          url: tab.url, 
          id: tab.id, 
          favIconUrl: tab.favIconUrl,
          combined: `${tab.title} ${tab.url}`
        }));
        fuseTabs.setCollection(tabsData);
        displayResults(tabsList, tabsData, true);
      });
    } catch (error) {
      console.error('Error in fetchTabs:', error);
    }
  }

  function fetchBookmarks(limitDisplay = false) {
    try {
      chrome.bookmarks.getTree(function(bookmarkTreeNodes) {
        if (chrome.runtime.lastError) {
          console.error('Error fetching bookmarks:', chrome.runtime.lastError.message);
          return;
        }
        const flattenBookmarks = (nodes) => {
          let bookmarks = [];
          for (let node of nodes) {
            if (node.url) {
              bookmarks.push({ 
                title: node.title, 
                url: node.url, 
                id: node.id,
                combined: `${node.title} ${node.url}`
              });
            }
            if (node.children) {
              bookmarks = bookmarks.concat(flattenBookmarks(node.children));
            }
          }
          return bookmarks;
        };
        bookmarksData = flattenBookmarks(bookmarkTreeNodes);
        fuseBookmarks.setCollection(bookmarksData);
        // Limit display to 10 items when no search query, but keep all for search
        const displayData = limitDisplay ? bookmarksData.slice(0, 10) : bookmarksData;
        displayResults(bookmarksList, displayData, false);
      });
    } catch (error) {
      console.error('Error in fetchBookmarks:', error);
    }
  }

  function fetchHistory(query, limitDisplay = false) {
    try {
      // Always fetch enough history items for search index (1000 items)
      // But limit display to 10 items when no search query
      chrome.history.search({ text: query, maxResults: 1000 }, function(historyItems) {
        if (chrome.runtime.lastError) {
          console.error('Error fetching history:', chrome.runtime.lastError.message);
          return;
        }
        historyData = historyItems.map(item => ({ 
          title: item.title, 
          url: item.url, 
          id: item.id,
          combined: `${item.title} ${item.url}`
        }));
        
        // Memory management: limit array size if it grows too large
        if (historyData.length > MAX_HISTORY_ITEMS) {
          historyData = historyData.slice(0, MAX_HISTORY_ITEMS);
        }
        
        fuseHistory.setCollection(historyData);
        historyLoaded = true;
        
        // Limit display to 10 items when no search query, but keep all for search
        const displayData = limitDisplay ? historyData.slice(0, 10) : historyData;
        displayResults(historyList, displayData, false);
      });
    } catch (error) {
      console.error('Error in fetchHistory:', error);
    }
  }

  function fetchClosedTabs(limitDisplay = false) {
    try {
      // Chrome API limit is 25 for maxResults
      // But limit display to 10 items when no search query
      chrome.sessions.getRecentlyClosed({ maxResults: 25 }, function(sessions) {
        if (chrome.runtime.lastError) {
          console.error('Error fetching closed tabs:', chrome.runtime.lastError.message);
          return;
        }
        const allClosedTabs = sessions.filter(session => session.tab).map(session => ({
          title: session.tab.title,
          url: session.tab.url,
          id: session.sessionId,
          favIconUrl: session.tab.favIconUrl,
          isClosedTab: true,
          combined: `${session.tab.title} ${session.tab.url}`
        }));
        
        // Memory management: limit array size if it grows too large
        closedTabsData = allClosedTabs.length > MAX_CLOSED_TABS_ITEMS 
          ? allClosedTabs.slice(0, MAX_CLOSED_TABS_ITEMS) 
          : allClosedTabs;
        
        fuseClosedTabs.setCollection(closedTabsData);
        closedTabsLoaded = true;
        
        // Limit display to 10 items when no search query, but keep all for search
        const displayData = limitDisplay ? closedTabsData.slice(0, 10) : closedTabsData;
        displayResults(closedTabsList, displayData, false);
      });
    } catch (error) {
      console.error('Error in fetchClosedTabs:', error);
    }
  }

  function filterResults(query) {
    // Lazy load history and closed tabs if not already loaded
    if (!historyLoaded) {
      fetchHistory('', false);
    }
    if (!closedTabsLoaded) {
      fetchClosedTabs(false);
    }
    
    // Show all matching results when searching (no limit)
    const filteredTabs = fuseTabs.search(query).map(result => result.item);
    const filteredBookmarks = fuseBookmarks.search(query).map(result => result.item);
    const filteredHistory = fuseHistory.search(query).map(result => result.item);
    const filteredClosedTabs = fuseClosedTabs.search(query).map(result => result.item);

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
    
    // Clear previous debounce timer
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
    }
    
    // Debounce search to improve performance (150ms delay)
    searchDebounceTimer = setTimeout(() => {
      if (query) {
        filterResults(query);
      } else {
        fetchTabs();
        fetchBookmarks(true); // Limit display to 10, but all bookmarks are indexed
        // Lazy load history and closed tabs only when needed (on first search or when clearing search)
        // This improves initial popup load time
        if (historyLoaded) {
          fetchHistory('', true); // Only refetch if already loaded
        }
        if (closedTabsLoaded) {
          fetchClosedTabs(true); // Only refetch if already loaded
        }

        setTimeout(selectFirstItem, 50); // optional fallback
      }
    }, 150);
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
  fetchBookmarks(true); // Limit to 10 for initial display
  // Lazy load history and closed tabs - only load when user searches
  // This improves initial popup load time significantly

  function handleInputEnter(query) {
    try {
      if (isUrl(query)) {
        let url = query;
        if (!/^https?:\/\//i.test(url)) {
          url = 'https://' + url;
        }
        chrome.tabs.create({ url: url }, () => {
          if (chrome.runtime.lastError) {
            console.error('Error creating tab:', chrome.runtime.lastError.message);
          }
        });
      } else {
        chrome.search.query({ text: query, disposition: 'NEW_TAB' }, () => {
          if (chrome.runtime.lastError) {
            console.error('Error performing search:', chrome.runtime.lastError.message);
          }
        });
      }
    } catch (error) {
      console.error('Error in handleInputEnter:', error);
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
  try {
    chrome.storage.sync.get(defaultSettings, (settings) => {
      if (chrome.runtime.lastError) {
        console.error('Error loading settings:', chrome.runtime.lastError.message);
        // Use defaults if storage fails
        applySettings(defaultSettings);
        updateInputs(defaultSettings);
        return;
      }
      applySettings(settings);
      updateInputs(settings);
    });
  } catch (error) {
    console.error('Error in storage.get:', error);
    // Use defaults if storage fails
    applySettings(defaultSettings);
    updateInputs(defaultSettings);
  }

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

      try {
        chrome.storage.sync.set(newSettings, () => {
          if (chrome.runtime.lastError) {
            console.error('Error saving settings:', chrome.runtime.lastError.message);
          }
        });
      } catch (error) {
        console.error('Error in storage.set:', error);
      }
    });
  });

  // Save (Close)
  btnSave.addEventListener('click', () => {
    settingsPanel.classList.remove('open');
  });

  // Reset
  btnReset.addEventListener('click', () => {
    try {
      chrome.storage.sync.set(defaultSettings, () => {
        if (chrome.runtime.lastError) {
          console.error('Error resetting settings:', chrome.runtime.lastError.message);
          return;
        }
        applySettings(defaultSettings);
        updateInputs(defaultSettings);
      });
    } catch (error) {
      console.error('Error in reset:', error);
    }
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
