const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const log = require('electron-log');

// 日志配置
log.transports.file.level = 'info';
log.transports.file.maxSize = 10 * 1024 * 1024;
log.transports.console.level = 'debug';
log.info('QClaw Desktop 启动... v1.3.0');

// 全局变量
let mainWindow;

// OpenClaw 路径
const OPENCLAW_DIR = path.join(process.env.HOME, '.openclaw');
const OPENCLAW_CONFIG = path.join(OPENCLAW_DIR, 'openclaw.json');
const MEMORY_DIR = path.join(OPENCLAW_DIR, 'workspace', 'memory');
const GATEWAY_LOG = path.join(OPENCLAW_DIR, 'logs', 'gateway.log');
const TOKEN_STATS_FILE = path.join(OPENCLAW_DIR, 'token-stats.json');

// 创建窗口
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'ClawDesk',
    backgroundColor: '#0a0a0f',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  log.info('主窗口创建完成');
}

// 执行命令的Promise封装 - 使用绝对路径
function execPromise(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { maxBuffer: 10 * 1024 * 1024, env: { ...process.env, PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin' } }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve(stdout || stderr);
      }
    });
  });
}

// 获取 OpenClaw 状态
async function getOpenClawStatus() {
  try {
    const status = {
      installed: false,
      version: null,
      gateway: { running: false, pid: null, uptime: null },
      node: { running: false, pid: null, uptime: null },
      config: null,
      memory: { files: 0, totalSize: 0 },
      skills: []
    };

    // 检查是否安装
    if (fs.existsSync(OPENCLAW_CONFIG)) {
      status.installed = true;
      status.config = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG, 'utf-8'));
      status.version = status.config.meta?.lastTouchedVersion || 'unknown';
    }

    // 检查进程 - 使用 pgrep -f 匹配命令行
    try {
      const gatewayResult = await execPromise('pgrep -f openclaw-gateway');
      const gatewayPid = parseInt((gatewayResult || '').trim().split('\n')[0]);
      if (gatewayPid) {
        const uptime = await getProcessUptime(gatewayPid);
        status.gateway = { running: true, pid: gatewayPid, uptime };
      }
    } catch {}

    try {
      const nodeResult = await execPromise('pgrep -f openclaw-node');
      const nodePid = parseInt((nodeResult || '').trim().split('\n')[0]);
      if (nodePid) {
        const uptime = await getProcessUptime(nodePid);
        status.node = { running: true, pid: nodePid, uptime };
      }
    } catch {}

    // 内存文件
    if (fs.existsSync(MEMORY_DIR)) {
      const files = fs.readdirSync(MEMORY_DIR);
      status.memory.files = files.length;
      let totalSize = 0;
      for (const file of files) {
        const stat = fs.statSync(path.join(MEMORY_DIR, file));
        totalSize += stat.size;
      }
      status.memory.totalSize = totalSize;
    }

    // Skills
    const skillsDir = path.join(OPENCLAW_DIR, 'workspace', 'skills');
    if (fs.existsSync(skillsDir)) {
      status.skills = fs.readdirSync(skillsDir);
    }

    return status;
  } catch (error) {
    log.error('获取状态失败:', error);
    return { installed: false, error: error.message };
  }
}

// 获取进程运行时长
async function getProcessUptime(pid) {
  try {
    const { stdout } = await execPromise(`ps -p ${pid} -o etime=`);
    return (stdout || '').trim();
  } catch {
    return null;
  }
}

// 获取详细进程信息
async function getProcessDetails() {
  try {
    const processes = [];
    
    // 分别获取 Gateway 和 Node - 使用 pgrep -f 匹配命令行
    for (const procPattern of ['openclaw-gateway', 'openclaw-node']) {
      try {
        // 使用 pgrep 获取 PID
        const pidResult = await execPromise(`pgrep -f ${procPattern}`);
        const pids = (pidResult || '').trim().split('\n').filter(p => p && !isNaN(parseInt(p)));
        
        for (const pidStr of pids) {
          const pid = parseInt(pidStr);
          if (!pid) continue;
          
          // macOS ps 命令 - 跳过表头行
          const infoResult = await execPromise(`ps -p ${pid} -o %cpu,%mem,rss,etime | tail -1`);
          const parts = (infoResult || '').trim().split(/\s+/);
          
          // parts[0] = %CPU, parts[1] = %MEM, parts[2] = RSS, parts[3] = ELAPSED
          if (parts.length >= 4) {
            const cpu = parseFloat(parts[0] || 0).toFixed(1);
            const mem = parseFloat(parts[1] || 0).toFixed(1);
            const rss = Math.round(parseInt(parts[2] || 0) / 1024); // KB to MB
            const uptime = parts[3] || '-';
            
            // 避免重复添加
            if (!processes.find(p => p.pid === pid)) {
              processes.push({
                pid,
                name: procPattern.includes('gateway') ? 'Gateway' : 'Node',
                cpu,
                mem,
                rss,
                uptime
              });
            }
          }
        }
      } catch {
        // 进程不存在
      }
    }
    
    return processes;
  } catch (error) {
    log.error('获取进程详情失败:', error);
    return [];
  }
}

// 读取配置
async function readConfig() {
  try {
    if (fs.existsSync(OPENCLAW_CONFIG)) {
      const config = fs.readFileSync(OPENCLAW_CONFIG, 'utf-8');
      // 验证 JSON
      JSON.parse(config);
      return { success: true, config };
    }
    return { success: false, error: '配置文件不存在' };
  } catch (error) {
    return { success: false, error: 'JSON格式错误: ' + error.message };
  }
}

// 保存配置
async function saveConfig(configStr) {
  try {
    // 验证 JSON
    JSON.parse(configStr);
    fs.writeFileSync(OPENCLAW_CONFIG, configStr);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// 获取模型配置
async function getModelConfig() {
  try {
    if (!fs.existsSync(OPENCLAW_CONFIG)) {
      return { success: false, error: '配置文件不存在' };
    }
    
    const config = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG, 'utf-8'));
    // 兼容新旧配置结构
    const providers = config.models?.providers || config.providers || {};
    const defaults = config.agents?.defaults || {};
    
    const models = [];
    for (const [providerName, providerData] of Object.entries(providers)) {
      if (providerData.models) {
        for (const model of providerData.models) {
          const isDefault = defaults.model?.primary === `${providerName}/${model.id}`;
          models.push({
            provider: providerName,
            id: model.id,
            name: model.name || model.id,
            reasoning: model.reasoning || false,
            inputCost: model.cost?.input || 0,
            outputCost: model.cost?.output || 0,
            cacheReadCost: model.cost?.cacheRead || 0,
            cacheWriteCost: model.cost?.cacheWrite || 0,
            contextWindow: model.contextWindow || 0,
            maxTokens: model.maxTokens || 0,
            isDefault
          });
        }
      }
    }
    
    return {
      success: true,
      models,
      defaultModel: defaults.model?.primary || null,
      providers: Object.keys(providers)
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// 更新模型配置
async function updateModelConfig(provider, modelId, updates) {
  try {
    if (!fs.existsSync(OPENCLAW_CONFIG)) {
      return { success: false, error: '配置文件不存在' };
    }
    
    const config = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG, 'utf-8'));
    
    // 兼容新旧配置结构
    const providers = config.models?.providers || config.providers || {};
    
    if (!providers[provider]) {
      return { success: false, error: '提供商不存在' };
    }
    
    const modelIndex = providers[provider].models?.findIndex(m => m.id === modelId);
    
    if (modelIndex === -1 || modelIndex === undefined) {
      return { success: false, error: '模型不存在' };
    }
    
    // 更新模型配置
    providers[provider].models[modelIndex] = {
      ...providers[provider].models[modelIndex],
      ...updates
    };
    
    // 确保写回正确的位置
    if (config.models?.providers) {
      config.models.providers = providers;
    } else {
      config.providers = providers;
    }
    
    fs.writeFileSync(OPENCLAW_CONFIG, JSON.stringify(config, null, 2));
    return { success: true, message: '模型配置已更新' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// 切换默认模型
async function switchModel(provider, modelId) {
  try {
    if (!fs.existsSync(OPENCLAW_CONFIG)) {
      return { success: false, error: '配置文件不存在' };
    }
    
    const config = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG, 'utf-8'));
    
    // 确保 agents.defaults 存在
    if (!config.agents) {
      config.agents = {};
    }
    if (!config.agents.defaults) {
      config.agents.defaults = {};
    }
    if (!config.agents.defaults.model) {
      config.agents.defaults.model = {};
    }
    
    // 设置新的默认模型
    config.agents.defaults.model.primary = `${provider}/${modelId}`;
    
    // 更新 aliases
    if (!config.agents.defaults.models) {
      config.agents.defaults.models = {};
    }
    config.agents.defaults.models[`${provider}/${modelId}`] = {
      alias: modelId
    };
    
    fs.writeFileSync(OPENCLAW_CONFIG, JSON.stringify(config, null, 2));
    
    // 通知重启
    return { success: true, message: '默认模型已切换，请重启 Gateway 使配置生效', needRestart: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// 添加新模型
async function addModel(provider, modelConfig) {
  try {
    if (!fs.existsSync(OPENCLAW_CONFIG)) {
      return { success: false, error: '配置文件不存在' };
    }
    
    const config = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG, 'utf-8'));
    
    // 兼容新旧配置结构 - 确保 providers 存在
    if (!config.models) config.models = {};
    if (!config.models.providers) config.models.providers = {};
    const providers = config.models.providers;
    
    if (!providers[provider]) {
      providers[provider] = { models: [] };
    }
    if (!providers[provider].models) {
      providers[provider].models = [];
    }
    
    // 检查是否已存在
    const exists = providers[provider].models.find(m => m.id === modelConfig.id);
    if (exists) {
      return { success: false, error: '模型已存在' };
    }
    
    // 添加模型
    providers[provider].models.push({
      id: modelConfig.id,
      name: modelConfig.name || modelConfig.id,
      reasoning: modelConfig.reasoning || false,
      input: ['text'],
      cost: {
        input: modelConfig.inputCost || 0,
        output: modelConfig.outputCost || 0,
        cacheRead: modelConfig.cacheReadCost || 0,
        cacheWrite: modelConfig.cacheWriteCost || 0
      },
      contextWindow: modelConfig.contextWindow || 200000,
      maxTokens: modelConfig.maxTokens || 8192
    });
    
    fs.writeFileSync(OPENCLAW_CONFIG, JSON.stringify(config, null, 2));
    return { success: true, message: '模型已添加' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// 删除模型
async function deleteModel(provider, modelId) {
  try {
    if (!fs.existsSync(OPENCLAW_CONFIG)) {
      return { success: false, error: '配置文件不存在' };
    }
    
    const config = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG, 'utf-8'));
    
    // 兼容新旧配置结构
    const providers = config.models?.providers || config.providers || {};
    
    if (!providers[provider]) {
      return { success: false, error: '提供商不存在' };
    }
    
    const models = providers[provider].models || [];
    const filteredModels = models.filter(m => m.id !== modelId);
    
    if (filteredModels.length === models.length) {
      return { success: false, error: '模型不存在' };
    }
    
    providers[provider].models = filteredModels;
    
    // 确保写回正确的位置
    if (config.models?.providers) {
      config.models.providers = providers;
    } else {
      config.providers = providers;
    }
    
    // 如果删除的是默认模型，清除默认配置
    const defaultModel = config.agents?.defaults?.model?.primary;
    if (defaultModel === `${provider}/${modelId}`) {
      if (config.agents.defaults.model) {
        config.agents.defaults.model.primary = '';
      }
    }
    
    fs.writeFileSync(OPENCLAW_CONFIG, JSON.stringify(config, null, 2));
    return { success: true, message: '模型已删除' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// 获取 Token 统计
async function getTokenStats() {
  try {
    const stats = {
      providers: [],
      totalCalls: 0,
      totalTokens: 0
    };

    if (fs.existsSync(OPENCLAW_CONFIG)) {
      const config = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG, 'utf-8'));
      const providers = config.providers || {};
      
      for (const [name, data] of Object.entries(providers)) {
        if (data.models) {
          for (const model of data.models) {
            stats.providers.push({
              name,
              model: model.id,
              inputCost: model.cost?.input || 0,
              outputCost: model.cost?.output || 0,
              contextWindow: model.contextWindow || 0
            });
          }
        }
      }
    }
    return stats;
  } catch (error) {
    return { providers: [], error: error.message };
  }
}

// 获取内存文件列表
async function getMemoryFiles() {
  try {
    if (!fs.existsSync(MEMORY_DIR)) {
      return { files: [], totalSize: 0 };
    }
    
    const files = fs.readdirSync(MEMORY_DIR)
      .filter(f => f.endsWith('.md') || f.endsWith('.json'))
      .map(f => {
        const fullPath = path.join(MEMORY_DIR, f);
        const stat = fs.statSync(fullPath);
        return {
          name: f,
          path: fullPath,
          size: stat.size,
          modified: stat.mtime.toISOString(),
          content: stat.size < 100000 ? fs.readFileSync(fullPath, 'utf-8').substring(0, 500) : null
        };
      });
    
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    return { files, totalSize };
  } catch (error) {
    return { files: [], totalSize: 0, error: error.message };
  }
}

// 删除内存文件
async function deleteMemoryFile(filename) {
  try {
    const fullPath = path.join(MEMORY_DIR, filename);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
      return { success: true };
    }
    return { success: false, error: '文件不存在' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// 获取 Skills 列表
async function getSkillsList() {
  try {
    const skillsDir = path.join(OPENCLAW_DIR, 'workspace', 'skills');
    if (!fs.existsSync(skillsDir)) {
      return { success: true, skills: [], count: 0 };
    }
    
    const skills = fs.readdirSync(skillsDir);
    const skillDetails = [];
    
    for (const skill of skills) {
      try {
        const skillPath = path.join(skillsDir, skill);
        
        // 使用 lstatSync 处理符号链接
        let stat;
        try {
          stat = fs.lstatSync(skillPath);
        } catch {
          // 跳过无法访问的技能
          continue;
        }
        
        // 跳过非目录项（如符号链接指向不存在的路径）
        if (!stat.isDirectory()) {
          continue;
        }
        
        const skillFile = path.join(skillPath, 'SKILL.md');
        let description = '';
        
        if (fs.existsSync(skillFile)) {
          try {
            const content = fs.readFileSync(skillFile, 'utf-8');
            const match = content.match(/description[^\n]*([^\n]+)/);
            description = match ? match[1].trim() : '';
          } catch {}
        }
        
        skillDetails.push({
          name: skill,
          path: skillPath,
          size: stat.size,
          description
        });
      } catch {
        // 跳过有问题的技能
        continue;
      }
    }
    
    return { success: true, skills: skillDetails, count: skillDetails.length };
  } catch (error) {
    log.error('获取技能列表失败:', error);
    return { success: false, error: error.message };
  }
}

// 安装 Skill
async function installSkill(skillName) {
  try {
    log.info(`安装技能: ${skillName}`);
    await execPromise(`/opt/homebrew/bin/pnpm add -g @skills/${skillName} 2>/dev/null || /opt/homebrew/bin/npx skills add ${skillName}`);
    return { success: true };
  } catch (error) {
    log.error('安装技能失败:', error);
    return { success: false, error: error.message };
  }
}

// 获取日志
async function getLogs(lines = 100) {
  try {
    const logPath = path.join(OPENCLAW_DIR, 'logs');
    const logFile = path.join(logPath, 'gateway.log');
    
    if (fs.existsSync(logFile)) {
      const content = fs.readFileSync(logFile, 'utf-8');
      const allLines = content.split('\n');
      return { success: true, logs: allLines.slice(-lines).join('\n'), total: allLines.length };
    }
    
    return { success: true, logs: '暂无日志\n提示: 日志文件位于 ~/.openclaw/logs/gateway.log', total: 0 };
  } catch (error) {
    return { success: true, logs: '暂无日志', total: 0 };
  }
}

// 执行快捷命令
async function executeCommand(cmd) {
  try {
    log.info(`执行命令: ${cmd}`);
    
    switch (cmd) {
      case 'restart-gateway':
        await execPromise('launchctl stop ai.openclaw.gateway');
        await new Promise(r => setTimeout(r, 1000));
        await execPromise('launchctl start ai.openclaw.gateway');
        return { success: true, message: 'Gateway 重启成功' };
        
      case 'restart-node':
        await execPromise('launchctl stop ai.openclaw.node');
        await new Promise(r => setTimeout(r, 1000));
        await execPromise('launchctl start ai.openclaw.node');
        return { success: true, message: 'Node 重启成功' };
        
      case 'restart-all':
        await execPromise('launchctl stop ai.openclaw.gateway');
        await execPromise('launchctl stop ai.openclaw.node');
        await new Promise(r => setTimeout(r, 1500));
        await execPromise('launchctl start ai.openclaw.node');
        await execPromise('launchctl start ai.openclaw.gateway');
        return { success: true, message: '全部服务重启成功' };
        
      case 'clear-memory':
        if (fs.existsSync(MEMORY_DIR)) {
          const files = fs.readdirSync(MEMORY_DIR);
          for (const file of files) {
            if (file !== 'MEMORY.md') {
              fs.unlinkSync(path.join(MEMORY_DIR, file));
            }
          }
        }
        return { success: true, message: '临时记忆已清理' };
        
      case 'open-dashboard':
        shell.openExternal('http://127.0.0.1:18789');
        return { success: true, message: 'Dashboard 已打开' };
        
      case 'open-config':
        shell.showItemInFolder(OPENCLAW_CONFIG);
        return { success: true, message: '配置文件已选中' };
        
      case 'update-openclaw':
        await execPromise('env PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" /opt/homebrew/bin/npm install -g openclaw');
        return { success: true, message: 'OpenClaw 更新完成，请重启应用' };
        
      default:
        return { success: false, error: '未知命令' };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ========== IM 渠道配置 ==========

// 支持的 IM 平台
const IM_PLATFORMS = {
  feishu: { name: '飞书', icon: '📮' },
  dingtalk: { name: '钉钉', icon: '💬' },
  qq: { name: 'QQ', icon: '🐧' },
  wecom: { name: '企业微信', icon: '💼' }
};

// 获取 IM 渠道配置
async function getChannelConfig() {
  try {
    if (!fs.existsSync(OPENCLAW_CONFIG)) {
      return { success: false, error: '配置文件不存在' };
    }
    
    const config = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG, 'utf-8'));
    const channels = config.channels || {};
    
    const result = {};
    for (const [platform, platformInfo] of Object.entries(IM_PLATFORMS)) {
      result[platform] = {
        name: platformInfo.name,
        icon: platformInfo.icon,
        enabled: channels[platform]?.enabled || false,
        config: channels[platform] || {},
        hasToken: !!(channels[platform]?.botToken || channels[platform]?.appKey)
      };
    }
    
    return { success: true, channels: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// 更新 IM 渠道配置
async function updateChannelConfig(platform, updates) {
  try {
    if (!IM_PLATFORMS[platform]) {
      return { success: false, error: '不支持的平台: ' + platform };
    }
    
    if (!fs.existsSync(OPENCLAW_CONFIG)) {
      return { success: false, error: '配置文件不存在' };
    }
    
    const config = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG, 'utf-8'));
    
    if (!config.channels) {
      config.channels = {};
    }
    
    // 合并配置
    config.channels[platform] = {
      ...config.channels[platform],
      ...updates,
      enabled: updates.enabled !== undefined ? updates.enabled : (config.channels[platform]?.enabled || false)
    };
    
    fs.writeFileSync(OPENCLAW_CONFIG, JSON.stringify(config, null, 2));
    
    return { success: true, message: `${IM_PLATFORMS[platform].name} 配置已更新` };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// 启用/禁用 IM 渠道
async function toggleChannel(platform, enabled) {
  return updateChannelConfig(platform, { enabled });
}

// ========== 备份与恢复 ==========

const BACKUP_DIR = path.join(OPENCLAW_DIR, 'backups');

// 获取备份列表
async function getBackupList() {
  try {
    if (!fs.existsSync(BACKUP_DIR)) {
      return { success: true, backups: [] };
    }
    
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const fullPath = path.join(BACKUP_DIR, f);
        const stat = fs.statSync(fullPath);
        return {
          name: f,
          path: fullPath,
          size: stat.size,
          created: stat.birthtime.toISOString(),
          modified: stat.mtime.toISOString()
        };
      })
      .sort((a, b) => new Date(b.created) - new Date(a.created));
    
    return { success: true, backups: files };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// 创建备份
async function createBackup(name) {
  try {
    if (!fs.existsSync(OPENCLAW_CONFIG)) {
      return { success: false, error: '配置文件不存在' };
    }
    
    // 确保备份目录存在
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = name || `backup-${timestamp}.json`;
    const backupPath = path.join(BACKUP_DIR, backupName);
    
    // 读取现有配置
    const config = fs.readFileSync(OPENCLAW_CONFIG, 'utf-8');
    
    // 创建备份（包含元数据）
    const backup = {
      version: '1.0',
      created: new Date().toISOString(),
      openclawVersion: JSON.parse(config).meta?.lastTouchedVersion || 'unknown',
      config: JSON.parse(config)
    };
    
    fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
    
    return { success: true, message: '备份已创建', path: backupPath };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// 恢复备份
async function restoreBackup(backupName) {
  try {
    const backupPath = path.join(BACKUP_DIR, backupName);
    
    if (!fs.existsSync(backupPath)) {
      return { success: false, error: '备份文件不存在' };
    }
    
    const backup = JSON.parse(fs.readFileSync(backupPath, 'utf-8'));
    
    if (!backup.config) {
      return { success: false, error: '备份文件格式无效' };
    }
    
    // 先创建当前配置的备份
    await createBackup('auto-backup-before-restore.json');
    
    // 恢复配置
    fs.writeFileSync(OPENCLAW_CONFIG, JSON.stringify(backup.config, null, 2));
    
    return { success: true, message: '配置已恢复，请重启 Gateway 使配置生效', needRestart: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// 删除备份
async function deleteBackup(backupName) {
  try {
    const backupPath = path.join(BACKUP_DIR, backupName);
    
    if (fs.existsSync(backupPath)) {
      fs.unlinkSync(backupPath);
      return { success: true, message: '备份已删除' };
    }
    
    return { success: false, error: '备份文件不存在' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// 导出配置到指定位置
async function exportConfig(targetPath) {
  try {
    if (!fs.existsSync(OPENCLAW_CONFIG)) {
      return { success: false, error: '配置文件不存在' };
    }
    
    const config = fs.readFileSync(OPENCLAW_CONFIG, 'utf-8');
    fs.writeFileSync(targetPath, config);
    
    return { success: true, message: '配置已导出到: ' + targetPath };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// 从指定位置导入配置
async function importConfig(sourcePath) {
  try {
    if (!fs.existsSync(sourcePath)) {
      return { success: false, error: '文件不存在' };
    }
    
    // 验证 JSON 格式
    const config = JSON.parse(fs.readFileSync(sourcePath, 'utf-8'));
    
    // 先备份当前配置
    await createBackup('auto-backup-before-import.json');
    
    // 写入新配置
    fs.writeFileSync(OPENCLAW_CONFIG, JSON.stringify(config, null, 2));
    
    return { success: true, message: '配置已导入，请重启 Gateway 使配置生效', needRestart: true };
  } catch (error) {
    return { success: false, error: '导入失败: ' + error.message };
  }
}

// ========== 增强网关管理 ==========

// 强制重启网关
async function forceRestartGateway() {
  try {
    log.info('执行强制重启网关...');
    
    // 先尝试正常停止
    try {
      await execPromise('launchctl stop ai.openclaw.gateway');
    } catch {}
    
    // 等待一秒
    await new Promise(r => setTimeout(r, 1000));
    
    // 检查进程是否还在运行，如果还在就 kill
    try {
      const pids = await execPromise('pgrep -f openclaw-gateway');
      if (pids) {
        const pidList = pids.trim().split('\n').filter(p => p && !isNaN(parseInt(p)));
        for (const pid of pidList) {
          try {
            await execPromise(`kill -9 ${pid}`);
            log.info(`已强制终止进程: ${pid}`);
          } catch {}
        }
      }
    } catch {}
    
    await new Promise(r => setTimeout(r, 1000));
    
    // 启动
    await execPromise('launchctl start ai.openclaw.gateway');
    
    return { success: true, message: '强制重启成功' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// 自检修复
async function selfCheckAndRepair() {
  try {
    const results = {
      checks: [],
      fixed: [],
      errors: []
    };
    
    // 1. 检查配置文件
    try {
      if (fs.existsSync(OPENCLAW_CONFIG)) {
        JSON.parse(fs.readFileSync(OPENCLAW_CONFIG, 'utf-8'));
        results.checks.push({ name: '配置文件', status: 'ok' });
      } else {
        results.checks.push({ name: '配置文件', status: 'error', message: '配置文件不存在' });
        results.errors.push('配置文件不存在');
      }
    } catch (e) {
      results.checks.push({ name: '配置文件', status: 'error', message: 'JSON格式错误' });
      results.errors.push('配置文件格式错误: ' + e.message);
    }
    
    // 2. 检查 Gateway 进程
    try {
      const gatewayResult = await execPromise('pgrep -f openclaw-gateway');
      if (gatewayResult && gatewayResult.trim()) {
        results.checks.push({ name: 'Gateway 进程', status: 'ok', pid: gatewayResult.trim() });
      } else {
        results.checks.push({ name: 'Gateway 进程', status: 'error', message: '未运行' });
        results.fixed.push('Gateway 进程已重新启动');
        await execPromise('launchctl start ai.openclaw.gateway');
      }
    } catch (e) {
      results.errors.push('检查 Gateway 进程失败');
    }
    
    // 3. 检查 Node 进程
    try {
      const nodeResult = await execPromise('pgrep -f openclaw-node');
      if (nodeResult && nodeResult.trim()) {
        results.checks.push({ name: 'Node 进程', status: 'ok', pid: nodeResult.trim() });
      } else {
        results.checks.push({ name: 'Node 进程', status: 'error', message: '未运行' });
        results.fixed.push('Node 进程已重新启动');
        await execPromise('launchctl start ai.openclaw.node');
      }
    } catch (e) {
      results.errors.push('检查 Node 进程失败');
    }
    
    // 4. 检查日志目录
    const logDir = path.join(OPENCLAW_DIR, 'logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
      results.fixed.push('已创建日志目录');
    }
    results.checks.push({ name: '日志目录', status: 'ok' });
    
    // 5. 检查 Skills 目录
    const skillsDir = path.join(OPENCLAW_DIR, 'workspace', 'skills');
    if (fs.existsSync(skillsDir)) {
      results.checks.push({ name: 'Skills 目录', status: 'ok' });
    } else {
      fs.mkdirSync(skillsDir, { recursive: true });
      results.fixed.push('已创建 Skills 目录');
    }
    
    // 6. 检查 memory 目录
    const memoryDir = path.join(OPENCLAW_DIR, 'workspace', 'memory');
    if (!fs.existsSync(memoryDir)) {
      fs.mkdirSync(memoryDir, { recursive: true });
      results.fixed.push('已创建记忆目录');
    }
    results.checks.push({ name: '记忆目录', status: 'ok' });
    
    await new Promise(r => setTimeout(r, 2000));
    
    return {
      success: results.errors.length === 0,
      message: results.errors.length === 0 ? '自检完成，所有检查正常' : '自检完成，发现问题已自动修复',
      results
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// 获取网关诊断信息
async function getGatewayDiagnostics() {
  try {
    const diagnostics = {
      timestamp: new Date().toISOString(),
      config: null,
      channels: {},
      processes: [],
      logs: { recent: '', errors: [] }
    };
    
    // 读取配置
    if (fs.existsSync(OPENCLAW_CONFIG)) {
      const config = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG, 'utf-8'));
      diagnostics.config = {
        version: config.meta?.lastTouchedVersion || 'unknown',
        channels: Object.keys(config.channels || {}),
        providers: Object.keys(config.providers || config.models?.providers || {})
      };
      
      // 脱敏敏感信息
      if (config.channels) {
        for (const [key, ch] of Object.entries(config.channels)) {
          diagnostics.channels[key] = {
            enabled: ch.enabled,
            hasToken: !!(ch.botToken || ch.appKey)
          };
        }
      }
    }
    
    // 获取进程信息
    diagnostics.processes = await getProcessDetails();
    
    // 获取最近错误日志
    if (fs.existsSync(GATEWAY_LOG)) {
      const content = fs.readFileSync(GATEWAY_LOG, 'utf-8');
      const lines = content.split('\n');
      diagnostics.logs.recent = lines.slice(-50).join('\n');
      
      // 提取错误行
      diagnostics.logs.errors = lines
        .filter(l => l.toLowerCase().includes('error') || l.toLowerCase().includes('fail'))
        .slice(-20);
    }
    
    return diagnostics;
  } catch (error) {
    return { error: error.message };
  }
}

// 获取系统资源使用
async function getSystemResources() {
  try {
    const cpuLoad = os.loadavg()[0].toFixed(2);
    const totalMem = Math.round(os.totalmem() / 1024 / 1024 / 1024 * 100) / 100;
    const freeMem = Math.round(os.freemem() / 1024 / 1024 / 1024 * 100) / 100;
    const usedMem = totalMem - freeMem;
    
    return {
      cpuLoad,
      totalMem,
      freeMem,
      usedMem,
      uptime: os.uptime()
    };
  } catch (error) {
    return {};
  }
}

// 获取 Token 统计数据
async function getTokenStats() {
  try {
    // 读取模型配置获取价格
    let inputPrice = 0.4; // 默认 MiniMax M2.7
    let outputPrice = 1.5;
    
    if (fs.existsSync(OPENCLAW_CONFIG)) {
      const config = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG, 'utf-8'));
      // 兼容新旧配置结构
      const providers = config.models?.providers || config.providers || {};
      for (const [name, data] of Object.entries(providers)) {
        if (data.models && data.models.length > 0) {
          inputPrice = data.models[0].cost?.input || inputPrice;
          outputPrice = data.models[0].cost?.output || outputPrice;
          break;
        }
      }
    }
    
    // 解析日志获取使用量
    const stats = {
      today: { requests: 0, inputTokens: 0, outputTokens: 0, cost: 0 },
      week: { requests: 0, inputTokens: 0, outputTokens: 0, cost: 0 },
      month: { requests: 0, inputTokens: 0, outputTokens: 0, cost: 0 },
      total: { requests: 0, inputTokens: 0, outputTokens: 0, cost: 0 },
      inputPrice,
      outputPrice,
      lastUpdated: new Date().toISOString()
    };
    
    // 读取统计缓存文件
    let cachedStats = {};
    if (fs.existsSync(TOKEN_STATS_FILE)) {
      try {
        cachedStats = JSON.parse(fs.readFileSync(TOKEN_STATS_FILE, 'utf-8'));
      } catch {}
    }
    
    // 读取网关日志
    if (fs.existsSync(GATEWAY_LOG)) {
      const logContent = fs.readFileSync(GATEWAY_LOG, 'utf-8');
      const lines = logContent.split('\n');
      
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const weekStart = todayStart - 7 * 24 * 60 * 60 * 1000;
      const monthStart = todayStart - 30 * 24 * 60 * 60 * 1000;
      
      // 解析日志行
      for (const line of lines) {
        // 匹配 MiniMax API 调用日志
        // 格式示例: [minimax] req id=xxx duration=xxxms input_tokens=xxx output_tokens=xxx
        const match = line.match(/input_tokens[=:]?\s*(\d+).*output_tokens[=:]?\s*(\d+)/i);
        if (match) {
          const inputTokens = parseInt(match[1]) || 0;
          const outputTokens = parseInt(match[2]) || 0;
          const timestamp = parseLogTimestamp(line) || now.getTime();
          
          const cost = (inputTokens / 1000) * inputPrice + (outputTokens / 1000) * outputPrice;
          
          stats.total.requests++;
          stats.total.inputTokens += inputTokens;
          stats.total.outputTokens += outputTokens;
          stats.total.cost += cost;
          
          if (timestamp >= todayStart) {
            stats.today.requests++;
            stats.today.inputTokens += inputTokens;
            stats.today.outputTokens += outputTokens;
            stats.today.cost += cost;
          }
          
          if (timestamp >= weekStart) {
            stats.week.requests++;
            stats.week.inputTokens += inputTokens;
            stats.week.outputTokens += outputTokens;
            stats.week.cost += cost;
          }
          
          if (timestamp >= monthStart) {
            stats.month.requests++;
            stats.month.inputTokens += inputTokens;
            stats.month.outputTokens += outputTokens;
            stats.month.cost += cost;
          }
        }
      }
    }
    
    // 合并缓存数据（用于补充未记录的历史数据）
    if (cachedStats.total) {
      stats.total = cachedStats.total;
      stats.today = cachedStats.today || stats.today;
      stats.week = cachedStats.week || stats.week;
      stats.month = cachedStats.month || stats.month;
    }
    
    // 保存更新后的统计
    fs.writeFileSync(TOKEN_STATS_FILE, JSON.stringify(stats, null, 2));
    
    return stats;
  } catch (error) {
    log.error('获取Token统计失败:', error);
    return { error: error.message };
  }
}

// 解析日志时间戳
function parseLogTimestamp(line) {
  // 尝试从日志行中提取时间戳
  // 格式: 2026-03-19T10:25:43.214+08:00
  const match = line.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
  if (match) {
    return new Date(match[1]).getTime();
  }
  return null;
}

// 获取 Token 统计历史
async function getTokenHistory() {
  try {
    const history = {
      daily: [],
      labels: []
    };
    
    // 从日志中提取每日使用量
    if (fs.existsSync(GATEWAY_LOG)) {
      const logContent = fs.readFileSync(GATEWAY_LOG, 'utf-8');
      const lines = logContent.split('\n');
      
      // 按天统计
      const dailyStats = {};
      
      for (const line of lines) {
        const match = line.match(/input_tokens[=:]?\s*(\d+).*output_tokens[=:]?\s*(\d+)/i);
        if (match) {
          const timestamp = parseLogTimestamp(line);
          if (timestamp) {
            const date = new Date(timestamp);
            const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;
            
            if (!dailyStats[dateStr]) {
              dailyStats[dateStr] = { requests: 0, inputTokens: 0, outputTokens: 0, cost: 0 };
            }
            
            dailyStats[dateStr].requests++;
            dailyStats[dateStr].inputTokens += parseInt(match[1]) || 0;
            dailyStats[dateStr].outputTokens += parseInt(match[2]) || 0;
          }
        }
      }
      
      // 转换为数组
      const sortedDates = Object.keys(dailyStats).sort();
      const last7Days = sortedDates.slice(-7);
      
      for (const date of last7Days) {
        history.daily.push(dailyStats[date]);
        history.labels.push(date);
      }
    }
    
    return history;
  } catch (error) {
    return { daily: [], labels: [] };
  }
}

// IPC 处理器
ipcMain.handle('get-status', getOpenClawStatus);
ipcMain.handle('get-process-details', getProcessDetails);
ipcMain.handle('read-config', readConfig);
ipcMain.handle('save-config', saveConfig);
ipcMain.handle('get-token-stats', getTokenStats);
ipcMain.handle('get-memory-files', getMemoryFiles);
ipcMain.handle('delete-memory-file', async (event, filename) => deleteMemoryFile(filename));
ipcMain.handle('get-skills', getSkillsList);
ipcMain.handle('install-skill', async (event, skillName) => installSkill(skillName));
ipcMain.handle('get-logs', async (event, lines) => getLogs(lines));
ipcMain.handle('execute-command', async (event, cmd) => executeCommand(cmd));
ipcMain.handle('get-system-resources', getSystemResources);
ipcMain.handle('get-token-history', getTokenHistory);
ipcMain.handle('get-model-config', getModelConfig);
ipcMain.handle('update-model-config', async (event, provider, modelId, updates) => updateModelConfig(provider, modelId, updates));
ipcMain.handle('switch-model', async (event, provider, modelId) => switchModel(provider, modelId));
ipcMain.handle('add-model', async (event, provider, config) => addModel(provider, config));
ipcMain.handle('delete-model', async (event, provider, modelId) => deleteModel(provider, modelId));
ipcMain.handle('open-external', async (event, url) => shell.openExternal(url));

// IM 渠道配置
ipcMain.handle('get-channel-config', getChannelConfig);
ipcMain.handle('update-channel-config', async (event, platform, updates) => updateChannelConfig(platform, updates));
ipcMain.handle('toggle-channel', async (event, platform, enabled) => toggleChannel(platform, enabled));

// 备份与恢复
ipcMain.handle('get-backup-list', getBackupList);
ipcMain.handle('create-backup', async (event, name) => createBackup(name));
ipcMain.handle('restore-backup', async (event, backupName) => restoreBackup(backupName));
ipcMain.handle('delete-backup', async (event, backupName) => deleteBackup(backupName));
ipcMain.handle('export-config', async (event, targetPath) => exportConfig(targetPath));
ipcMain.handle('import-config', async (event, sourcePath) => importConfig(sourcePath));

// 增强网关管理
ipcMain.handle('force-restart-gateway', forceRestartGateway);
ipcMain.handle('self-check-and-repair', selfCheckAndRepair);
ipcMain.handle('get-gateway-diagnostics', getGatewayDiagnostics);

// 应用启动
app.whenReady().then(() => {
  createWindow();
  log.info('应用已就绪 v1.3.0');
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
