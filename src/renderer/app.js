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
    case 'stats':
      loadTokenStats();
      break;
    case 'models':
      loadModels();
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

// 加载 Token 统计
async function loadTokenStats() {
  try {
    const stats = await window.qclawAPI.getTokenStats();
    
    if (stats.error) {
      console.error('获取Token统计失败:', stats.error);
      return;
    }
    
    // 更新概览卡片
    document.getElementById('stat-today-cost').textContent = '¥' + stats.today.cost.toFixed(2);
    document.getElementById('stat-today-tokens').textContent = formatNumber(stats.today.inputTokens + stats.today.outputTokens);
    
    document.getElementById('stat-week-cost').textContent = '¥' + stats.week.cost.toFixed(2);
    document.getElementById('stat-week-tokens').textContent = formatNumber(stats.week.inputTokens + stats.week.outputTokens);
    
    document.getElementById('stat-month-cost').textContent = '¥' + stats.month.cost.toFixed(2);
    document.getElementById('stat-month-tokens').textContent = formatNumber(stats.month.inputTokens + stats.month.outputTokens);
    
    document.getElementById('stat-total-cost').textContent = '¥' + stats.total.cost.toFixed(2);
    document.getElementById('stat-total-tokens').textContent = formatNumber(stats.total.inputTokens + stats.total.outputTokens);
    
    // 更新表格
    document.getElementById('tbl-today-requests').textContent = stats.today.requests;
    document.getElementById('tbl-today-input').textContent = formatNumber(stats.today.inputTokens);
    document.getElementById('tbl-today-output').textContent = formatNumber(stats.today.outputTokens);
    document.getElementById('tbl-today-cost').textContent = '¥' + stats.today.cost.toFixed(2);
    
    document.getElementById('tbl-week-requests').textContent = stats.week.requests;
    document.getElementById('tbl-week-input').textContent = formatNumber(stats.week.inputTokens);
    document.getElementById('tbl-week-output').textContent = formatNumber(stats.week.outputTokens);
    document.getElementById('tbl-week-cost').textContent = '¥' + stats.week.cost.toFixed(2);
    
    document.getElementById('tbl-month-requests').textContent = stats.month.requests;
    document.getElementById('tbl-month-input').textContent = formatNumber(stats.month.inputTokens);
    document.getElementById('tbl-month-output').textContent = formatNumber(stats.month.outputTokens);
    document.getElementById('tbl-month-cost').textContent = '¥' + stats.month.cost.toFixed(2);
    
    document.getElementById('tbl-total-requests').textContent = stats.total.requests;
    document.getElementById('tbl-total-input').textContent = formatNumber(stats.total.inputTokens);
    document.getElementById('tbl-total-output').textContent = formatNumber(stats.total.outputTokens);
    document.getElementById('tbl-total-cost').textContent = '¥' + stats.total.cost.toFixed(2);
    
    // 加载图表
    const history = await window.qclawAPI.getTokenHistory();
    renderTokenChart(history);
    
  } catch (error) {
    console.error('加载Token统计失败:', error);
  }
}

// 加载模型配置
async function loadModels() {
  try {
    const result = await window.qclawAPI.getModelConfig();
    
    if (!result.success) {
      document.getElementById('models-container').innerHTML = `<div class="loading">加载失败: ${result.error}</div>`;
      return;
    }
    
    // 更新当前默认模型
    const defaultEl = document.getElementById('current-default-model');
    if (result.defaultModel) {
      const [provider, model] = result.defaultModel.split('/');
      defaultEl.innerHTML = `<span class="model-provider">${provider}</span><span class="model-name">${model}</span>`;
    } else {
      defaultEl.innerHTML = '<span class="model-name">未设置</span>';
    }
    
    // 渲染模型列表
    const container = document.getElementById('models-container');
    
    if (!result.models || result.models.length === 0) {
      container.innerHTML = '<div class="loading">暂无配置模型</div>';
      return;
    }
    
    let html = '<div class="models-grid">';
    for (const model of result.models) {
      const isDefault = model.isDefault;
      html += `
        <div class="model-card ${isDefault ? 'active' : ''}" onclick="editModel('${model.provider}', '${model.id}')">
          <div class="model-card-header">
            <span class="model-card-name">${model.name}</span>
            ${isDefault ? '<span class="model-card-badge">默认</span>' : ''}
          </div>
          <div class="model-card-provider">${model.provider}</div>
          <div class="model-card-info">
            输入: $${model.inputCost}/1K | 输出: $${model.outputCost}/1K<br>
            上下文: ${formatNumber(model.contextWindow)} | 最大: ${formatNumber(model.maxTokens)}
          </div>
          <div class="model-card-actions">
            <button onclick="event.stopPropagation(); switchToModel('${model.provider}', '${model.id}')">设为默认</button>
            <button onclick="event.stopPropagation(); editModel('${model.provider}', '${model.id}')">编辑</button>
          </div>
        </div>
      `;
    }
    html += '</div>';
    container.innerHTML = html;
    
  } catch (error) {
    console.error('加载模型配置失败:', error);
    document.getElementById('models-container').innerHTML = '<div class="loading">加载失败</div>';
  }
}

// 编辑模型
let currentEditProvider = null;
let currentEditModelId = null;

async function editModel(provider, modelId) {
  currentEditProvider = provider;
  currentEditModelId = modelId;
  
  const result = await window.qclawAPI.getModelConfig();
  if (!result.success) return;
  
  const model = result.models.find(m => m.provider === provider && m.id === modelId);
  if (!model) return;
  
  // 填充表单
  document.getElementById('model-id').value = model.id;
  document.getElementById('model-name').value = model.name;
  document.getElementById('model-input-cost').value = model.inputCost;
  document.getElementById('model-output-cost').value = model.outputCost;
  document.getElementById('model-context').value = model.contextWindow;
  document.getElementById('model-max-tokens').value = model.maxTokens;
  document.getElementById('model-reasoning').checked = model.reasoning;
  
  // 显示表单
  document.getElementById('model-actions').style.display = 'block';
  document.getElementById('model-actions').scrollIntoView({ behavior: 'smooth' });
}

// 保存模型配置
async function saveModelConfig() {
  if (!currentEditProvider || !currentEditModelId) return;
  
  const updates = {
    name: document.getElementById('model-name').value,
    inputCost: parseFloat(document.getElementById('model-input-cost').value) || 0,
    outputCost: parseFloat(document.getElementById('model-output-cost').value) || 0,
    contextWindow: parseInt(document.getElementById('model-context').value) || 200000,
    maxTokens: parseInt(document.getElementById('model-max-tokens').value) || 8192,
    reasoning: document.getElementById('model-reasoning').checked
  };
  
  const result = await window.qclawAPI.updateModelConfig(currentEditProvider, currentEditModelId, updates);
  
  if (result.success) {
    showNotification('模型配置已保存', 'success');
    hideModelForm();
    loadModels();
  } else {
    showNotification('保存失败: ' + result.error, 'error');
  }
}

// 隐藏模型表单
function hideModelForm() {
  document.getElementById('model-actions').style.display = 'none';
  currentEditProvider = null;
  currentEditModelId = null;
}

// 切换默认模型
async function switchToModel(provider, modelId) {
  const result = await window.qclawAPI.switchModel(provider, modelId);
  
  if (result.success) {
    showNotification(result.message, 'success');
    loadModels();
  } else {
    showNotification('切换失败: ' + result.error, 'error');
  }
}

// 删除模型
async function deleteCurrentModel() {
  if (!currentEditProvider || !currentEditModelId) return;
  
  if (!confirm('确定要删除这个模型吗？')) return;
  
  const result = await window.qclawAPI.deleteModel(currentEditProvider, currentEditModelId);
  
  if (result.success) {
    showNotification('模型已删除', 'success');
    hideModelForm();
    loadModels();
  } else {
    showNotification('删除失败: ' + result.error, 'error');
  }
}

// 显示添加模型对话框
function showAddModelDialog() {
  document.getElementById('add-model-dialog').style.display = 'flex';
}

// 隐藏添加模型对话框
function hideAddModelDialog() {
  document.getElementById('add-model-dialog').style.display = 'none';
  // 清空表单
  document.getElementById('add-model-id').value = '';
  document.getElementById('add-model-name').value = '';
}

// 添加新模型
async function addNewModel() {
  const provider = document.getElementById('add-provider').value;
  const modelId = document.getElementById('add-model-id').value.trim();
  const modelName = document.getElementById('add-model-name').value.trim();
  
  if (!modelId) {
    showNotification('请输入模型 ID', 'error');
    return;
  }
  
  const config = {
    id: modelId,
    name: modelName || modelId,
    inputCost: parseFloat(document.getElementById('add-input-cost').value) || 0,
    outputCost: parseFloat(document.getElementById('add-output-cost').value) || 0
  };
  
  const result = await window.qclawAPI.addModel(provider, config);
  
  if (result.success) {
    showNotification('模型已添加', 'success');
    hideAddModelDialog();
    loadModels();
  } else {
    showNotification('添加失败: ' + result.error, 'error');
  }
}

// 重启 Gateway
async function restartGateway() {
  try {
    showNotification('正在重启 Gateway...', 'info');
    const result = await window.qclawAPI.executeCommand('restart-gateway');
    if (result.success) {
      showNotification('Gateway 重启成功', 'success');
    } else {
      showNotification('重启失败: ' + result.error, 'error');
    }
  } catch (error) {
    showNotification('重启失败: ' + error.message, 'error');
  }
}

// 渲染 Token 图表
function renderTokenChart(history) {
  const container = document.getElementById('chart-container');
  
  if (!history.daily || history.daily.length === 0) {
    container.innerHTML = '<div class="chart-placeholder">暂无数据</div>';
    return;
  }
  
  const maxCost = Math.max(...history.daily.map(d => d.cost), 0.01);
  
  let html = '';
  for (let i = 0; i < history.daily.length; i++) {
    const day = history.daily[i];
    const height = Math.max((day.cost / maxCost) * 100, 5);
    const label = history.labels[i] || '';
    const value = '¥' + day.cost.toFixed(2);
    
    html += `<div class="chart-bar" style="height: ${height}%" data-label="${label}" data-value="${value}"></div>`;
  }
  
  container.innerHTML = html;
}

// 格式化数字
function formatNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
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
    
    if (!container) {
      console.error('skills-grid element not found');
      return;
    }
    
    if (!result || !result.success) {
      container.innerHTML = `<div class="loading">加载失败: ${result?.error || '未知错误'}</div>`;
      return;
    }
    
    if (!result.skills || result.skills.length === 0) {
      container.innerHTML = '<div class="loading">暂无已安装的技能<br><br>点击上方「➕ 安装技能」按钮开始安装</div>';
      return;
    }
    
    container.innerHTML = result.skills.map(s => `
      <div class="skill-card">
        <div class="skill-icon">🧩</div>
        <div class="skill-name">${escapeHtml(s.name || '')}</div>
        <div class="skill-desc">${escapeHtml(s.description || '无描述')}</div>
        <div class="skill-meta">${formatSize(s.size || 0)}</div>
        <div class="skill-actions">
          <button class="btn-skill-action" onclick="uninstallSkill('${escapeHtml(s.name || '')}')">卸载</button>
        </div>
      </div>
    `).join('');
    
  } catch (error) {
    console.error('加载技能失败:', error);
    const container = document.getElementById('skills-grid');
    if (container) {
      container.innerHTML = `<div class="loading">加载失败: ${error.message}</div>`;
    }
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
