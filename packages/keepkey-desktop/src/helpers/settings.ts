import { ipcMain } from 'electron'
import log from 'electron-log'
import type { AddressInfo } from 'net'

import { db, kkAutoLauncher, server, tcpBridgeRunning } from '../globalState'
import { startTcpBridge, stopTcpBridge } from '../tcpBridge'
import { setAllowPreRelease } from '../updaterListeners'

export type Settings = {
  // don't allow user to change these two settings
  shouldAutoStartBridge: boolean
  bridgeApiPort: number

  shouldAutoLunch: boolean
  shouldMinimizeToTray: boolean
  shouldAutoUpdate: boolean
  allowPreRelease: boolean
  allowBetaFirmware: boolean
}

export class SettingsInstance {
  static #singletonInitialized = false

  #shouldAutoStartBridge = true
  get shouldAutoStartBridge() {
    return this.#shouldAutoStartBridge
  }
  #bridgeApiPort = 1646
  get bridgeApiPort() {
    return this.#bridgeApiPort
  }

  #shouldAutoLunch = true
  get shouldAutoLunch() {
    return this.#shouldAutoLunch
  }

  #shouldMinimizeToTray = true
  get shouldMinimizeToTray() {
    return this.#shouldMinimizeToTray
  }

  #shouldAutoUpdate = true
  get shouldAutoUpdate() {
    return this.#shouldAutoUpdate
  }

  #allowPreRelease = false
  get allowPreRelease() {
    return this.#allowPreRelease
  }

  #allowBetaFirmware = false
  get allowBetaFirmware() {
    return this.#allowBetaFirmware
  }

  constructor() {
    if (SettingsInstance.#singletonInitialized) {
      throw new Error('SettingsInstance can only be initialized once')
    }
    SettingsInstance.#singletonInitialized = true

    ipcMain.on('@app/update-settings', async (_event, data) => {
      await this.updateBulkSettings(data)
    })

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ipcMain.on('@app/settings', (event, _data) => {
      event.sender.send('@app/settings', {
        shouldAutoLunch: this.shouldAutoLunch,
        shouldAutoStartBridge: this.shouldAutoStartBridge,
        shouldMinimizeToTray: this.shouldMinimizeToTray,
        shouldAutoUpdate: this.shouldAutoUpdate,
        bridgeApiPort: this.bridgeApiPort,
        allowPreRelease: this.allowPreRelease,
        allowBetaFirmware: this.allowBetaFirmware,
      })
    })
  }

  async loadSettingsFromDb() {
    const doc = await db.findOne<{ settings: Settings }>({ type: 'settings' })
    if (!doc) {
      await this.syncSettingsWithDB()
      return this
    }

    if (
      doc.settings.shouldAutoLunch === undefined ||
      doc.settings.shouldAutoStartBridge === undefined ||
      doc.settings.shouldMinimizeToTray === undefined ||
      doc.settings.shouldAutoUpdate === undefined ||
      doc.settings.bridgeApiPort === undefined ||
      doc.settings.allowPreRelease === undefined ||
      doc.settings.allowBetaFirmware === undefined
    ) {
      await this.syncSettingsWithDB()
    }

    this.#shouldAutoLunch = doc.settings.shouldAutoLunch
    this.#shouldAutoStartBridge = doc.settings.shouldAutoStartBridge
    this.#shouldMinimizeToTray = doc.settings.shouldMinimizeToTray
    this.#shouldAutoUpdate = doc.settings.shouldAutoUpdate
    this.#bridgeApiPort = doc.settings.bridgeApiPort
    this.#allowPreRelease = doc.settings.allowPreRelease
    this.#allowBetaFirmware = doc.settings.allowBetaFirmware
    console.log('Loaded settings: ', doc.settings)

    return this
  }

  private async syncSettingsWithDB() {
    await db.update(
      { type: 'settings' },
      {
        type: 'settings',
        settings: {
          shouldAutoLunch: this.shouldAutoLunch,
          shouldAutoStartBridge: this.shouldAutoStartBridge,
          shouldMinimizeToTray: this.shouldMinimizeToTray,
          shouldAutoUpdate: this.shouldAutoUpdate,
          bridgeApiPort: this.bridgeApiPort,
          allowPreRelease: this.allowPreRelease,
          allowBetaFirmware: this.allowBetaFirmware,
        },
      },
      {
        upsert: true,
      },
    )
  }

  async setShouldAutoLunch(value: boolean) {
    this.#shouldAutoLunch = value
    const autoLaunch = await kkAutoLauncher.isEnabled()
    if (!autoLaunch && value) await kkAutoLauncher.enable()
    if (!autoLaunch && !value) await kkAutoLauncher.disable()
    await this.syncSettingsWithDB()
  }

  async setShouldAutoStartBridge(value: boolean) {
    this.#shouldAutoStartBridge = value
    await this.syncSettingsWithDB()
  }

  async setShouldMinimizeToTray(value: boolean) {
    this.#shouldMinimizeToTray = value
    await this.syncSettingsWithDB()
  }

  async setShouldAutoUpdate(value: boolean) {
    this.#shouldAutoUpdate = value
    await this.syncSettingsWithDB()
  }

  async setBridgeApiPort(value: number) {
    this.#bridgeApiPort = value
    if (tcpBridgeRunning) {
      const address = server.address() as AddressInfo
      if (address.port !== value) {
        await stopTcpBridge()
        await startTcpBridge(value)
      }
    }
    await this.syncSettingsWithDB()
  }

  async setAllowPreRelease(value: boolean) {
    this.#allowPreRelease = value
    setAllowPreRelease(value)
    await this.syncSettingsWithDB()
  }

  async setAllowBetaFirmware(value: boolean) {
    this.#allowBetaFirmware = value
    await this.syncSettingsWithDB()
  }

  async updateBulkSettings({
    shouldAutoLunch,
    shouldAutoStartBridge,
    shouldMinimizeToTray,
    shouldAutoUpdate,
    bridgeApiPort,
    allowPreRelease,
    allowBetaFirmware,
  }: {
    shouldAutoLunch?: boolean
    shouldAutoStartBridge?: boolean
    shouldMinimizeToTray?: boolean
    shouldAutoUpdate?: boolean
    bridgeApiPort?: number
    allowPreRelease?: boolean
    allowBetaFirmware?: boolean
  }) {
    log.info(
      shouldAutoLunch,
      shouldAutoStartBridge,
      shouldMinimizeToTray,
      shouldAutoUpdate,
      bridgeApiPort,
      allowPreRelease,
      allowBetaFirmware,
    )
    if (shouldAutoLunch !== undefined) this.#shouldAutoLunch = shouldAutoLunch
    if (shouldAutoStartBridge !== undefined) this.#shouldAutoStartBridge = shouldAutoStartBridge
    if (shouldMinimizeToTray !== undefined) this.#shouldMinimizeToTray = shouldMinimizeToTray
    if (shouldAutoUpdate !== undefined) this.#shouldAutoUpdate = shouldAutoUpdate
    if (bridgeApiPort !== undefined) this.#bridgeApiPort = bridgeApiPort
    if (allowPreRelease !== undefined) this.#allowPreRelease = allowPreRelease
    if (allowBetaFirmware !== undefined) this.#allowBetaFirmware = allowBetaFirmware
    await this.syncSettingsWithDB()
  }
}
