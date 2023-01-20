function init() {
  const NO_APPS_FOUND = 'NoAppsFound';

  function updateEntry(source, intent, app) {
    if (source[intent.name] === undefined) {
      source[intent.name] = {
        intent: {
          name: intent.name,
          displayName: intent.displayName,
        },
        apps: [],
      };
    }
    source[intent.name].apps.push(app);
    return source;
  }

  async function getIntent(intent, contextType) {
    const apps = await getApps();
    let intents = {};

    if (Array.isArray(apps)) {
      for (const value of apps) {
        if (value.intents !== undefined) {
          for (let i = 0; i < value.intents.length; i++) {
            if (value.intents[i].name === intent) {
              if (contextType === undefined) {
                intents = updateEntry(intents, value.intents[i], value);
              } else if (
                Array.isArray(value.intents[i].contexts) &&
                value.intents[i].contexts.includes(contextType)
              ) {
                intents = updateEntry(intents, value.intents[i], value);
              }
            }
          }
        }
      }

      const results = Object.values(intents);
      if (results.length === 0) {
        console.info(
          `[getIntent] No results found for findIntent for intent ${intent} and context ${contextType}`
        );
        return null;
      } else if (results.length === 1) {
        return results[0];
      }
      console.warn(
        `[getIntent] Received more than one result for findIntent for intent ${intent} and context ${contextType}. Returning the first entry.`
      );
      return results[0];
    }
    console.warn(
      `[getIntent] There was no apps returned so we are unable to find apps that support an intent`
    );
    return null;
  }

  async function launchApp(app) {
    const platform = fin.Platform.wrapSync({ uuid: app.appId });

    if (!(await platform.Application.isRunning())) {
      const targetApp = await fin.Application.startFromManifest(app.manifest);
      return targetApp.identity;
    }

    return app.appId;
  }

  function randomUUID() {
    const getRandomHex = (c) =>
      (
        c ^
        (window.crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))
      ).toString(16);
    return '10000000-1000-4000-8000-100000000000'.replace(
      /[018]/g,
      getRandomHex
    );
  }

  async function doesWindowExist(name, uuid) {
    const win = fin.Window.wrapSync({ name, uuid });
    let exists = false;

    try {
      await win.getInfo();
      exists = true;

      if (await win.isShowing()) {
        await win.bringToFront();
      }
    } catch {
      exists = false;
    }

    return exists;
  }

  async function launchWindow(windowApp) {
    if (windowApp === undefined || windowApp === null) {
      console.warn(`[launchWindow] No app was passed to launchWindow`);
      return null;
    }

    let manifest;

    const manifestResponse = await fetch(windowApp.manifest);
    manifest = await manifestResponse.json();

    manifest = {
      fdc3InteropApi: manifest.platform.defaultWindowOptions.fdc3InteropApi,
      url: manifest.snapshot.windows[0].url,
      name: manifest.snapshot.windows[0].name,
    };

    const name = manifest.name;
    let identity = { uuid: fin.me.identity.uuid, name };
    const wasNameSpecified = name !== undefined;
    let windowExists = false;

    if (wasNameSpecified) {
      windowExists = await doesWindowExist(identity.name, identity.uuid);
    } else {
      manifest.name = `classic-window-${randomUUID()}`;
      identity.name = manifest.name;
    }

    if (!windowExists) {
      try {
        const createdWindow = await fin.Window.create(manifest);
        identity = createdWindow.identity;
      } catch (err) {
        console.error(`[launchWindow] Error launching window: ${err}`);
        return null;
      }
    }
    return identity;
  }

  async function getApps() {
    console.info(`[getApps] Requesting apps`);
    return [
      {
        appId: 'platform_sender',
        name: 'platform_sender',
        manifest: 'http://localhost:4000/sender/sender.json',
        manifestType: 'openfin',
        title: 'platform_sender',
        description: 'platform_sender',
        images: [],
        contactEmail: 'support@openfin.co',
        supportEmail: 'support@openfin.co',
        publisher: 'openfin',
        icons: [],
        intents: [],
      },
      {
        appId: 'platform_receiver',
        name: 'platform_receiver',
        manifest: 'http://localhost:4000/receiver/receiver.json',
        manifestType: 'openfin',
        title: 'platform_receiver',
        description: 'platform_receiver',
        images: [],
        contactEmail: 'support@openfin.co',
        supportEmail: 'support@openfin.co',
        publisher: 'openfin',
        icons: [],
        intents: [
          {
            name: 'ViewChart',
            displayName: 'View Chart',
            contexts: ['fdc3.instrument'],
          },
        ],
      },
    ];
  }

  async function getAppsByIntent(intent) {
    const apps = await getApps();

    const filteredApps = apps.filter((value) => {
      if (value.intents === undefined) {
        return false;
      }

      for (let i = 0; i < value.intents.length; i++) {
        if (value.intents[i].name.toLowerCase() === intent.toLowerCase()) {
          return true;
        }
      }

      return false;
    });

    return filteredApps;
  }

  function interopOverride(InteropBroker, provider, options, ...args) {
    class InteropOverride extends InteropBroker {
      async handleInfoForIntent(intentOptions, clientIdentity) {
        console.info(`[handleInfoForIntent]`);

        const result = await getIntent(
          intentOptions.name,
          intentOptions.context?.type
        );

        if (result === null) {
          throw new Error(NO_APPS_FOUND);
        }

        const response = {
          intent: result.intent,
          apps: result.apps.map((app) => {
            const appEntry = {
              name: app.appId,
              appId: app.appId,
              title: app.title,
            };
            return appEntry;
          }),
        };

        return response;
      }

      async launchAppWithIntent(app, intent) {
        console.info(`[launchAppWithIntent], app: ${JSON.stringify(app)}`);
        console.info(
          `[launchAppWithIntent], intent: ${JSON.stringify(intent)}`
        );

        const identity = await launchApp(app);
        // const identity = await launchWindow(app);

        console.info(
          `[launchAppWithIntent] app launched, identity: ${JSON.stringify(
            identity
          )}`
        );

        await super.setIntentTarget(intent, identity);

        return {
          source: app.appId,
          version: app.version,
        };
      }

      async handleFiredIntent(intent) {
        console.info(`[handleFiredIntent] intent: ${JSON.stringify(intent)}`);

        let intentApps = await getAppsByIntent(intent.name);

        if (intentApps.length === 0) {
          console.info(`[handleFiredIntent] No apps support this intent`);
          throw new Error(NO_APPS_FOUND);
        }

        const intentResolver = await this.launchAppWithIntent(
          intentApps[0],
          intent
        );

        if (intentResolver === null) {
          throw new Error(NO_APPS_FOUND);
        }

        return intentResolver;
      }
    }

    return new InteropOverride(provider, options, ...args);
  }

  fin.Platform.init({ interopOverride });
}

init();
