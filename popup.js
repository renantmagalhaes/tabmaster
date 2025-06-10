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
    img.src = isTab ? (item.favIconUrl || 'default-favicon.png') : 'default-favicon.png';

    const span = document.createElement('span');
    span.textContent = item.title || item.url;

    li.dataset.url = item.url;
    li.dataset.id = item.id;
    li.appendChild(img);
    li.appendChild(span);

    li.addEventListener('click', () => {
      if (isTab) {
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
        id: session.tab.sessionId,
        favIconUrl: session.tab.favIconUrl
      }));
      fuseClosedTabs.setCollection(closedTabsData);
      displayResults(closedTabsList, closedTabsData, true);
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
    displayResults(closedTabsList, filteredClosedTabs, true);

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
      if (currentFocus > -1) {
        visibleItems[currentFocus].click();
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
});
