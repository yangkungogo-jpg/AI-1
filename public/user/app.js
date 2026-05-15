// 当前用户ID（存储在本地）
let currentUserId = localStorage.getItem('xiaohongshu_user_id');
let currentContent = null;

// 页面加载时获取内容
document.addEventListener('DOMContentLoaded', () => {
  loadContent();
});

// 加载内容
async function loadContent() {
  const loadingState = document.getElementById('loadingState');
  const emptyState = document.getElementById('emptyState');
  const contentCard = document.getElementById('contentCard');

  try {
    let url = '/api/content/assign';
    if (currentUserId) {
      url += `?userId=${encodeURIComponent(currentUserId)}`;
    }

    const response = await fetch(url);
    const result = await response.json();

    loadingState.style.display = 'none';

    if (!result.success) {
      emptyState.style.display = 'flex';
      return;
    }

    // 保存用户ID
    if (result.userId && !currentUserId) {
      currentUserId = result.userId;
      localStorage.setItem('xiaohongshu_user_id', currentUserId);
    }

    currentContent = result.content;
    renderContent(result.content);

  } catch (error) {
    console.error('加载内容失败:', error);
    loadingState.innerHTML = '<p style="color: #ff2442;">加载失败，请刷新重试</p>';
  }
}

// 渲染内容
function renderContent(content) {
  const emptyState = document.getElementById('emptyState');
  const contentCard = document.getElementById('contentCard');

  emptyState.style.display = 'none';
  contentCard.style.display = 'block';

  // 图片
  const imageSection = document.getElementById('imageSection');
  const contentImage = document.getElementById('contentImage');

  if (content.image_url) {
    imageSection.style.display = 'block';
    const imageSrc = content.image_url.startsWith('http')
      ? content.image_url
      : window.location.origin + content.image_url;
    contentImage.src = imageSrc;
    contentImage.onerror = () => {
      imageSection.style.display = 'none';
    };
  } else {
    imageSection.style.display = 'none';
  }

  // 标题
  document.getElementById('titleText').textContent = content.title;

  // 正文
  document.getElementById('contentText').textContent = content.content;

  // 话题
  const topicsContainer = document.getElementById('topicsContainer');
  topicsContainer.innerHTML = '';

  if (content.topics && content.topics.length > 0) {
    content.topics.forEach((topic) => {
      const topicItem = document.createElement('div');
      topicItem.className = 'topic-item';
      const span = document.createElement('span');
      span.textContent = '#' + topic;
      topicItem.appendChild(span);
      topicsContainer.appendChild(topicItem);
    });
  }
}

// 保存图片
function saveImage() {
  if (!currentContent || !currentContent.image_url) return;

  const imageUrl = currentContent.image_url;
  const filename = imageUrl.split('/').pop() || 'image.png';

  // 创建一个临时链接并触发下载
  const link = document.createElement('a');
  link.href = imageUrl;
  link.download = filename;
  link.target = '_blank';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  showToast('图片已保存');
}

// 复制标题
function copyTitle() {
  if (!currentContent) return;
  copyToClipboard(currentContent.title, '标题');
}

// 复制正文
function copyContent() {
  if (!currentContent) return;
  copyToClipboard(currentContent.content, '正文');
}

// 复制单个话题
function copySingleTopic(topic, buttonElement) {
  copyToClipboard(topic, '话题', buttonElement);
}

// 复制所有话题
function copyAllTopics() {
  if (!currentContent || !currentContent.topics || currentContent.topics.length === 0) return;

  const topicsText = currentContent.topics.map(t => '#' + t).join(' ');
  copyToClipboard(topicsText, '所有话题');
}

// 通用复制函数
async function copyToClipboard(text, label, buttonElement = null) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(`${label}已复制`);
    if (buttonElement) {
      buttonElement.classList.add('copied');
      setTimeout(() => buttonElement.classList.remove('copied'), 1500);
    }
  } catch (err) {
    console.error('复制失败:', err);
    showToast('复制失败，请手动选择复制');
  }
}

// 显示Toast提示
function showToast(message) {
  const toast = document.getElementById('toast');
  const toastMessage = document.getElementById('toastMessage');

  toastMessage.textContent = message;
  toast.classList.add('show');

  setTimeout(() => {
    toast.classList.remove('show');
  }, 2000);
}