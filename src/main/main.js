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
log.info('QClaw Desktop 启动... v1.1.0');

// 全局变量
let mainWindow;

// OpenClaw 路径
const OPENCLAW_DIR = path.join(process.env.HOME, '.openclaw');
const OPENCLAW_CONFIG = path.join(OPENCLAW_DIR, 'openclaw.json');
const MEMORY_DIR = path.join(OPENCLAW_DIR, 'memory');

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
    if (fs.existsSync(skillsDir)) {
      const skills = fs.readdirSync(skillsDir);
      const skillDetails = [];
      
      for (const skill of skills) {
        const skillPath = path.join(skillsDir, skill);
        const stat = fs.statSync(skillPath);
        const skillFile = path.join(skillPath, 'SKILL.md');
        let description = '';
        
        if (fs.existsSync(skillFile)) {
          const content = fs.readFileSync(skillFile, 'utf-8');
          const match = content.match(/description[^\n]*([^\n]+)/);
          description = match ? match[1].trim() : '';
        }
        
        skillDetails.push({
          name: skill,
          path: skillPath,
          size: stat.size,
          description
        });
      }
      
      return { success: true, skills: skillDetails, count: skillDetails.length };
    }
    return { success: true, skills: [], count: 0 };
  } catch (error) {
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
ipcMain.handle('open-external', async (event, url) => shell.openExternal(url));

// 应用启动
app.whenReady().then(() => {
  createWindow();
  log.info('应用已就绪 v1.1.0');
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
