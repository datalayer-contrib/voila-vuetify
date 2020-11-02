Vue.use(Vuetify);

Vue.component('jupyter-widget-mount-point', {
    data() {
        return {
            renderFn: undefined,
            elem: undefined,
        }
    },
    props: ['mount-id'],
    created() {
        requestWidget(this.mountId);
    },
    mounted() {
        requestWidget(this.mountId)
            .then(widgetView => {
                    if (['VuetifyView', 'VuetifyTemplateView'].includes(widgetView.model.get('_view_name'))) {
                        this.renderFn = createElement => widgetView.vueRender(createElement);
                    } else {
                        while (this.$el.firstChild) {
                            this.$el.removeChild(this.$el.firstChild);
                        }

                        requirejs(['@jupyter-widgets/base'], widgets =>
                            widgets.JupyterPhosphorWidget.attach(widgetView.pWidget, this.$el)
                        );
                    }
                }
            );
    },
    render(createElement) {
        if (this.renderFn) {
            /* workaround for v-menu click */
            if (!this.elem) {
                this.elem = this.renderFn(createElement);
            }
            return this.elem;
        }
        return createElement('div', this.$slots.default ||
            [createElement('v-chip' ,`[${this.mountId}]`)]);
    }
});

const widgetResolveFns = {};
const widgetPromises = {};

function provideWidget(mountId, widgetView) {
    if (widgetResolveFns[mountId]) {
        widgetResolveFns[mountId](widgetView);
    } else {
        widgetPromises[mountId] = Promise.resolve(widgetView);
    }
}

function requestWidget(mountId) {
    if (!widgetPromises[mountId]) {
        widgetPromises[mountId] = new Promise(resolve => widgetResolveFns[mountId] = resolve);
    }
    return widgetPromises[mountId];
}

function getWidgetManager(voila, kernel) {
    try {
        /* voila < 0.1.8 */
        return new voila.WidgetManager(kernel);
    } catch (e) {
        if (e instanceof TypeError) {
            /* voila >= 0.1.8 */
            const context = {
                session: {
                    kernel,
                    kernelChanged: {
                        connect: () => {}
                    },
                    statusChanged: {
                        connect: () => {}
                    },
                },
                saveState: {
                    connect: () => {}
                },
            };

            const settings = {
                saveState: false
            };

            const rendermime = new voila.RenderMimeRegistry({
                initialFactories: voila.standardRendererFactories
            });

            return new voila.WidgetManager(context, rendermime, settings);
        } else {
            throw e;
        }
    }
}

var themeIsdark;
if ('{{resources.theme}}' === 'dark') {
    themeIsdark = true;
}
if (window.location.search) {
    if (window.location.search.includes('theme=dark')) {
        themeIsdark = true;
    } else if (window.location.search.includes('theme=light')) {
        themeIsdark = false;
    }
}

window.init = async (voila) => {
    define("vue", [], () => Vue);
    define("vuetify", [], { framework: app.$vuetify });

    const kernel = await voila.connectKernel();
    window.addEventListener('beforeunload', () => kernel.shutdown());

    const widgetManager = getWidgetManager(voila, kernel);

    if (!window.enable_nbextensions) {
        const originalLoader = widgetManager.loader;
        widgetManager.loader = (moduleName, moduleVersion) => {
            if (moduleName === 'jupyter-vuetify' || moduleName === 'jupyter-vue') {
                requirejs.config({
                    paths: {
                        [moduleName]: [`${moduleName}/nodeps`, `https://unpkg.com/${moduleName}@${moduleVersion}/dist/nodeps`]
                    }
                });
            }
            return originalLoader(moduleName, moduleVersion);
        };
    }


    /* Workaround: prevent the theme from being overwritten by ipyvuetify initialization */
    let original;
    if (themeIsdark !== undefined) {
        original = app.$vuetify;
        app.$vuetify = {
            theme: {
                dark: false,
                themes: original.theme.themes
            }
        };
    }

    app.$data.loadingPercentage = -1;
    app.$data.loading_text = 'Loading widgets';

    await widgetManager.build_widgets();

    await Promise.all(Object.values(widgetManager._models)
        .map(async (modelPromise) => {
            const model = await modelPromise;
            if (model.name === 'ThemeModel' && themeIsdark !== undefined) {
                model.set('dark', themeIsdark);
                app.$vuetify = original;
            }
            const meta = model.get('_metadata');
            const mountId = meta && meta.mount_id;
            if (mountId && model.get('_view_name')) {
                const view = await widgetManager.create_view(model);
                provideWidget(mountId, view);
            }
        }));

    app.$data.loadingPercentage = 0;
    app.$data.loading_text = 'Done';
    app.$data.loading = false;
    removeInterferingStyleTags();

    setTimeout(voila.renderMathJax);
};

function removeInterferingStyleTags() {
    document.querySelectorAll("style:not(#vuetify-theme-stylesheet)")
        .forEach((styleTag) => {
            if (styleTag.textContent.includes("/* Override Blueprint's _reset.scss styles */")) {
                document.head.removeChild(styleTag);
            }
        });
}
