chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({
    url: chrome.runtime.getURL('viewer.html'),
  });
});

const FILE_PDF_REDIRECT_RULE_ID = 1;

const isPdfFileUrl = (url) => {
  try {
    const parsed = new URL(url);

    return parsed.protocol === 'file:' && parsed.pathname.toLowerCase().endsWith('.pdf');
  } catch {
    return false;
  }
};

const getFileUrlFromExtensionShortcut = (url) => {
  const prefix = chrome.runtime.getURL('');

  if (!url.startsWith(prefix)) {
    return null;
  }

  const extensionPath = url.slice(prefix.length);

  if (!extensionPath.toLowerCase().startsWith('file:///')) {
    return null;
  }

  const fileUrl = extensionPath;
  return isPdfFileUrl(fileUrl) ? fileUrl : null;
};

const getViewerUrl = (fileUrl) =>
  chrome.runtime.getURL(`viewer.html?file=${encodeURIComponent(fileUrl)}`);

const installPdfRedirectRule = async () => {
  if (!chrome.declarativeNetRequest?.updateDynamicRules) {
    return;
  }

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [FILE_PDF_REDIRECT_RULE_ID],
    addRules: [
      {
        id: FILE_PDF_REDIRECT_RULE_ID,
        priority: 100,
        action: {
          type: 'redirect',
          redirect: {
            regexSubstitution: `chrome-extension://${chrome.runtime.id}/viewer.html?file=\\0`,
          },
        },
        condition: {
          regexFilter: '^file:///.+\\.pdf(?:[?#].*)?$',
          isUrlFilterCaseSensitive: false,
          resourceTypes: ['main_frame'],
        },
      },
    ],
  });
};

const redirectPdfTab = (tabId, url) => {
  const fileUrl = isPdfFileUrl(url) ? url : getFileUrlFromExtensionShortcut(url);

  if (!fileUrl) {
    return;
  }

  chrome.tabs.update(tabId, {
    url: getViewerUrl(fileUrl),
  });
};

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url) {
    return;
  }

  redirectPdfTab(tabId, changeInfo.url);
});

chrome.runtime.onInstalled.addListener(() => {
  installPdfRedirectRule();
});

chrome.runtime.onStartup.addListener(() => {
  installPdfRedirectRule();
});

installPdfRedirectRule();
