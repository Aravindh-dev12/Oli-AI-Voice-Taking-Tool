import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('oli', {
  resize: (state) => ipcRenderer.send('oli:resize', state),
  openDashboard: () => ipcRenderer.send('oli:open-dashboard'),
  reportMeetingState: (active) => ipcRenderer.send('oli:meeting-state', active),
  onTrayToggleMeeting: (cb) => ipcRenderer.on('oli:tray-toggle-meeting', cb),
  onTogglePin: (cb) => ipcRenderer.on('oli:toggle-pin', cb),
  platform: () => ipcRenderer.invoke('oli:platform'),
  nativeCaptureAvailable: () => ipcRenderer.invoke('oli:native-capture-available'),
  startNativeCapture: (meetingId) => ipcRenderer.invoke('oli:native-capture-start', meetingId),
  stopNativeCapture: () => ipcRenderer.invoke('oli:native-capture-stop'),
  onNativeCaptureError: (cb) => ipcRenderer.on('oli:native-capture-error', (_event, payload) => cb(payload))
});
