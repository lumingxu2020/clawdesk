const { contextBridge, ipcRenderer } = require('electron');

// 暴露安全的 API 给渲染进程
contextBridge.exposeInMainWorld('qclawAPI', {
  // 状态
  getStatus: () => ipcRenderer.invoke('get-status'),
  getProcessDetails: () => ipcRenderer.invoke('get-process-details'),
  
  // 系统资源
  getSystemResources: () => ipcRenderer.invoke('get-system-resources'),
  
  // 配置
  readConfig: () => ipcRenderer.invoke('read-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  
  // 统计
  getTokenStats: () => ipcRenderer.invoke('get-token-stats'),
  
  // 内存管理
  getMemoryFiles: () => ipcRenderer.invoke('get-memory-files'),
  deleteMemoryFile: (filename) => ipcRenderer.invoke('delete-memory-file', filename),
  
  // Skills
  getSkills: () => ipcRenderer.invoke('get-skills'),
  installSkill: (name) => ipcRenderer.invoke('install-skill', name),
  
  // 日志
  getLogs: (lines) => ipcRenderer.invoke('get-logs', lines),
  
  // 命令执行
  executeCommand: (cmd) => ipcRenderer.invoke('execute-command', cmd),
  
  // 外部链接
  openExternal: (url) => ipcRenderer.invoke('open-external', url)
});
