// QClaw Desktop v1.1.0 - Renderer Process

// 全局状态
let currentPage = 'dashboard';
let autoRefreshTimer = null;

// 页面导航
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    const page = btn.dataset.page;
    navigateTo(page);
  });
});

// 导航到指定页面
function navigateTo(page) {
  // 更新导航状态
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.querySelector(`[data-page="${page}"]`)?.classList.add('active');
  
  // 更新页面显示
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(`page-${page}`)?.classList.add('active');
  
  currentPage = page;
  
  // 页面特定初始化
  switch (page) {
    case 'dashboard':
      refreshDashboard();
      break;
    case 'process':
      loadProcessDetails();
      break;
    case 'logs':
      loadLogs();
      break;
    case 'config':
      loadConfig();
      break;
    case 'memory':
      loadMemoryFiles();
      break;
    case 'skills':
      loadSkills();
      break;
  }
  
  // 重置自动刷新
  resetAutoRefresh();
}

// 自动刷新
function resetAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
  }
  
  if (currentPage === 'dashboard') {
    autoRefreshTimer = setInterval(refreshDashboard, 5000);
  }
}

// 初始化
async function init() {
  await refreshDashboard();
  resetAutoRefresh();
}

// 刷新仪表盘
async function refreshDashboard() {
  try {
    // 获取系统资源
    const resources = await window.qclawAPI.getSystemResources();
    if (resources.cpuLoad) {
      document.getElementById('cpu-value').textContent = resources.cpuLoad;
      const cpuPercent = Math.min(parseFloat(resources.cpuLoad) / 4 * 100, 100);
      document.getElementById('cpu-bar').style.width = cpuPercent + '%';
    }
    
    if (resources.totalMem) {
      const memPercent = (resources.usedMem / resources.totalMem * 100).toFixed(1);
      document.getElementById('mem-value').textContent = `${resources.usedMem}GB / ${resources.totalMem}GB`;
      document.getElementById('mem-bar').style.width = memPercent + '%';
    }
    
    if (resources.uptime) {
      const days = Math.floor(resources.uptime / 86400);
      const hours = Math.floor((resources.uptime % 86400) / 3600);
      document.getElementById('system-uptime').textContent = days > 0 ? `${days}天 ${hours}小时` : `${hours}小时`;
    }
    
    // 获取状态
    const status = await window.qclawAPI.getStatus();
    
    // OpenClaw 状态
    const openClawStatusEl = document.getElementById('openclaw-status');
    if (status.installed) {
      openClawStatusEl.textContent = `已安装 v${status.version}`;
      openClawStatusEl.className = 'status-value running';
    } else {
      openClawStatusEl.textContent = '未安装';
      openClawStatusEl.className = 'status-value stopped';
    }
    
    // Gateway 状态
    const gatewayEl = document.getElementById('gateway-status');
    if (status.gateway?.running) {
      const uptime = status.gateway.uptime || '-';
      gatewayEl.textContent = `运行中 (PID: ${status.gateway.pid}) ${uptime}`;
      gatewayEl.className = 'status-value running';
    } else {
      gatewayEl.textContent = '未运行';
      gatewayEl.className = 'status-value stopped';
    }
    
    // Node 状态
    const nodeEl = document.getElementById('node-status');
    if (status.node?.running) {
      const uptime = status.node.uptime || '-';
      nodeEl.textContent = `运行中 (PID: ${status.node.pid}) ${uptime}`;
      nodeEl.className = 'status-value running';
    } else {
      nodeEl.textContent = '未运行';
      nodeEl.className = 'status-value stopped';
    }
    
    // Skills
    document.getElementById('skills-count').textContent = status.skills?.length || 0;
    
    // 记忆文件
    document.getElementById('memory-files').textContent = `${status.memory?.files || 0} 个文件`;
    
  } catch (error) {
    console.error('刷新仪表盘失败:', error);
  }
}

// 刷新全部
async function refreshAll() {
  await refreshDashboard();
  showNotification('刷新完成', 'success');
}

// 加载进程详情
async function loadProcessDetails() {
  try {
    const processes = await window.qclawAPI.getProcessDetails();
    const container = document.getElementById('process-list');
    
    if (!processes || processes.length === 0) {
      container.innerHTML = '<div class="loading">暂无进程信息</div>';
      return;
    }
    
    container.innerHTML = processes.map(p => `
      <div class="process-item">
        <div class="process-item-header">
          <div class="process-item-icon">${p.name === 'Gateway' ? '⚡' : '🔗'}</div>
          <div class="process-item-info">
            <h3>${p.name}</h3>
            <p>PID: ${p.pid}</p>
          </div>
          <div class="process-status running">运行中</div>
        </div>
        <div class="process-metrics">
          <div class="metric">
            <div class="metric-value">${p.cpu}%</div>
            <div class="metric-label">CPU 使用</div>
          </div>
          <div class="metric">
            <div class="metric-value">${p.mem}%</div>
            <div class="metric-label">内存使用</div>
          </div>
          <div class="metric">
            <div class="metric-value">${p.rss}MB</div>
            <div class="metric-label">物理内存</div>
          </div>
          <div class="metric">
            <div class="metric-value">${p.uptime || '-'}</div>
            <div class="metric-label">运行时长</div>
          </div>
        </div>
      </div>
    `).join('');
    
  } catch (error) {
    console.error('加载进程详情失败:', error);
    document.getElementById('process-list').innerHTML = '<div class="loading">加载失败</div>';
  }
}

// 加载日志
async function loadLogs() {
  try {
    const lines = document.getElementById('log-lines')?.value || 100;
    const result = await window.qclawAPI.getLogs(parseInt(lines));
    const container = document.getElementById('log-content');
    
    if (result.logs) {
      // 高亮日志级别
      let highlighted = result.logs
        .replace(/ERROR/gi, '<span class="log-error">ERROR</span>')
        .replace(/WARN/gi, '<span class="log-warn">WARN</span>')
        .replace(/INFO/gi, '<span class="log-info">INFO</span>')
        .replace(/success/gi, '<span class="log-success">success</span>');
      
      container.innerHTML = highlighted;
    } else {
      container.textContent = '暂无日志';
    }
  } catch (error) {
    console.error('加载日志失败:', error);
    document.getElementById('log-content').textContent = '加载失败: ' + error.message;
  }
}

// 加载配置
async function loadConfig() {
  try {
    const result = await window.qclawAPI.readConfig();
    const editor = document.getElementById('config-editor');
    const status = document.getElementById('config-status');
    
    if (result.success && result.config) {
      editor.value = result.config;
      status.textContent = '✓ 已加载';
      status.className = 'config-status success';
    } else {
      editor.value = '// ' + (result.error || '加载失败');
      status.textContent = result.error || '加载失败';
      status.className = 'config-status error';
    }
  } catch (error) {
    console.error('加载配置失败:', error);
  }
}

// 保存配置
async function saveConfig() {
  try {
    const configStr = document.getElementById('config-editor').value;
    const status = document.getElementById('config-status');
    
    const result = await window.qclawAPI.saveConfig(configStr);
    
    if (result.success) {
      status.textContent = '✓ 保存成功';
      status.className = 'config-status success';
      showNotification('配置保存成功！Gateway 将在下次重启后使用新配置', 'success');
    } else {
      status.textContent = '✗ ' + result.error;
      status.className = 'config-status error';
      showNotification('保存失败: ' + result.error, 'error');
    }
  } catch (error) {
    showNotification('保存失败: ' + error.message, 'error');
  }
}

// 格式化配置
function formatConfig() {
  try {
    const editor = document.getElementById('config-editor');
    const config = JSON.parse(editor.value);
    editor.value = JSON.stringify(config, null, 2);
    showNotification('格式已整理', 'success');
  } catch (error) {
    showNotification('JSON 格式错误: ' + error.message, 'error');
  }
}

// 校验配置
function validateConfig() {
  try {
    const editor = document.getElementById('config-editor');
    JSON.parse(editor.value);
    showNotification('✓ JSON 格式正确', 'success');
  } catch (error) {
    showNotification('✗ JSON 格式错误: ' + error.message, 'error');
  }
}

// 打开配置目录
function openConfigFolder() {
  window.qclawAPI.executeCommand('open-config');
}

// 加载记忆文件
async function loadMemoryFiles() {
  try {
    const result = await window.qclawAPI.getMemoryFiles();
    const container = document.getElementById('memory-list');
    const sizeEl = document.getElementById('memory-size');
    
    if (!result.files || result.files.length === 0) {
      container.innerHTML = '<div class="loading">暂无记忆文件</div>';
      sizeEl.textContent = '总计: 0 KB';
      return;
    }
    
    const totalSizeKB = Math.round(result.totalSize / 1024);
    sizeEl.textContent = `总计: ${totalSizeKB} KB (${result.files.length} 个文件)`;
    
    container.innerHTML = result.files.map(f => `
      <div class="memory-item">
        <div class="memory-icon">🧠</div>
        <div class="memory-info">
          <div class="memory-name">${f.name}</div>
          <div class="memory-meta">${formatSize(f.size)} · ${new Date(f.modified).toLocaleString()}</div>
          ${f.content ? `<div class="memory-preview">${escapeHtml(f.content)}</div>` : ''}
        </div>
        <button class="memory-delete" onclick="deleteMemoryFile('${f.name}')">删除</button>
      </div>
    `).join('');
    
  } catch (error) {
    console.error('加载记忆文件失败:', error);
  }
}

// 删除记忆文件
async function deleteMemoryFile(filename) {
  if (!confirm(`确定要删除 ${filename} 吗？`)) return;
  
  try {
    const result = await window.qclawAPI.deleteMemoryFile(filename);
    if (result.success) {
      showNotification('已删除', 'success');
      await loadMemoryFiles();
    } else {
      showNotification('删除失败: ' + result.error, 'error');
    }
  } catch (error) {
    showNotification('删除失败: ' + error.message, 'error');
  }
}

// 清理临时记忆
async function clearTempMemory() {
  if (!confirm('确定要清理所有临时记忆文件吗？（MEMORY.md 会被保留）')) return;
  
  try {
    const result = await window.qclawAPI.executeCommand('clear-memory');
    if (result.success) {
      showNotification('临时记忆已清理', 'success');
      await loadMemoryFiles();
    } else {
      showNotification('清理失败: ' + result.error, 'error');
    }
  } catch (error) {
    showNotification('清理失败: ' + error.message, 'error');
  }
}

// 加载技能列表
async function loadSkills() {
  try {
    const result = await window.qclawAPI.getSkills();
    const container = document.getElementById('skills-grid');
    
    if (!result.skills || result.skills.length === 0) {
      container.innerHTML = '<div class="loading">暂无已安装的技能</div>';
      return;
    }
    
    container.innerHTML = result.skills.map(s => `
      <div class="skill-card">
        <div class="skill-icon">🧩</div>
        <div class="skill-name">${s.name}</div>
        <div class="skill-desc">${s.description || '无描述'}</div>
        <div class="skill-meta">${formatSize(s.size)}</div>
        <div class="skill-actions">
          <button class="btn-skill-action" onclick="uninstallSkill('${s.name}')">卸载</button>
        </div>
      </div>
    `).join('');
    
  } catch (error) {
    console.error('加载技能失败:', error);
  }
}

// 安装新技能
async function installNewSkill() {
  const skillName = prompt('请输入要安装的技能名称:\n\n常用技能:\n- ai-assistant\n- code-helper\n- image-gen\n- memory');
  if (!skillName) return;
  
  showNotification(`正在安装 ${skillName}...`, 'info');
  
  try {
    const result = await window.qclawAPI.installSkill(skillName);
    if (result.success) {
      showNotification(`✓ ${skillName} 安装成功！`, 'success');
      await loadSkills();
    } else {
      showNotification(`安装失败: ${result.error}`, 'error');
    }
  } catch (error) {
    showNotification('安装失败: ' + error.message, 'error');
  }
}

// 运行快捷命令
async function runCommand(cmd) {
  const outputDiv = document.getElementById('command-output');
  const outputContent = document.getElementById('output-content');
  const outputHeader = outputDiv.querySelector('.output-header');
  
  outputDiv.style.display = 'block';
  outputHeader.textContent = '执行中...';
  outputHeader.className = 'output-header';
  outputContent.textContent = '正在执行命令，请稍候...';
  
  try {
    const result = await window.qclawAPI.executeCommand(cmd);
    
    if (result.success) {
      outputHeader.textContent = '✓ ' + (result.message || '执行成功');
      outputHeader.className = 'output-header success';
      outputContent.textContent = result.message || '命令执行成功';
      showNotification(result.message || '操作完成', 'success');
    } else {
      outputHeader.textContent = '✗ 执行失败';
      outputHeader.className = 'output-header error';
      outputContent.textContent = result.error || '未知错误';
      showNotification('执行失败: ' + result.error, 'error');
    }
  } catch (error) {
    outputHeader.textContent = '✗ 执行失败';
    outputHeader.className = 'output-header error';
    outputContent.textContent = error.message;
    showNotification('执行失败: ' + error.message, 'error');
  }
}

// 工具函数
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
  return Math.round(bytes / 1024 / 1024 * 100) / 100 + ' MB';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showNotification(message, type = 'info') {
  // 简单的通知实现
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 16px 24px;
    background: ${type === 'success' ? '#22c55e' : type === 'error' ? '#ef4444' : '#3b82f6'};
    color: white;
    border-radius: 12px;
    font-size: 14px;
    z-index: 9999;
    animation: slideIn 0.3s ease;
  `;
  notification.textContent = message;
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.style.animation = 'fadeOut 0.3s ease';
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

// 添加动画样式
const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from { transform: translateX(100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
  @keyframes fadeOut {
    from { opacity: 1; }
    to { opacity: 0; }
  }
`;
document.head.appendChild(style);

// 事件绑定
document.addEventListener('DOMContentLoaded', () => {
  init();
});
