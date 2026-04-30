chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({
    url: chrome.runtime.getURL('viewer.html'),
  });
});

const PDF_REDIRECT_RULE_ID = 1;

const isSupportedPdfUrl = (url) => {
  try {
    const parsed = new URL(url);

    return (
      (parsed.protocol === 'file:' || parsed.protocol === 'https:') &&
      parsed.pathname.toLowerCase().endsWith('.pdf')
    );
  } catch {
    return false;
  }
};

const getDocumentUrlFromExtensionShortcut = (url) => {
  const prefix = chrome.runtime.getURL('');

  if (!url.startsWith(prefix)) {
    return null;
  }

  const extensionPath = url.slice(prefix.length);

  if (!extensionPath.toLowerCase().startsWith('file:///') && !extensionPath.toLowerCase().startsWith('https://')) {
    return null;
  }

  return isSupportedPdfUrl(extensionPath) ? extensionPath : null;
};

const getViewerUrl = (documentUrl) =>
  chrome.runtime.getURL(`viewer.html?file=${encodeURIComponent(documentUrl)}`);

const clearPdfRedirectRule = async () => {
  if (!chrome.declarativeNetRequest?.updateDynamicRules) {
    return;
  }

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [PDF_REDIRECT_RULE_ID],
  });
};

const redirectPdfTab = (tabId, url) => {
  const documentUrl = isSupportedPdfUrl(url) ? url : getDocumentUrlFromExtensionShortcut(url);

  if (!documentUrl) {
    return;
  }

  chrome.tabs.update(tabId, {
    url: getViewerUrl(documentUrl),
  });
};

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url) {
    return;
  }

  redirectPdfTab(tabId, changeInfo.url);
});

chrome.runtime.onInstalled.addListener(() => {
  clearPdfRedirectRule();
});

chrome.runtime.onStartup.addListener(() => {
  clearPdfRedirectRule();
});

clearPdfRedirectRule();
