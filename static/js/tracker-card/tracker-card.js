import { registerFunctionComponent } from 'webact';


async function TrackerCard () {
    const { useCSS, useHTML, postRender } = this;

    await useHTML();
    await useCSS();

    postRender(() => {
        
    });
}

export default registerFunctionComponent(TrackerCard, {
    name: 'tracker-card',
    metaUrl: import.meta.url
});
