import { registerFunctionComponent } from 'webact';


function TrackerCard () {
    const { useCSS, useHTML, postRender } = this;

    postRender(() => {
        
    });
}

export default registerFunctionComponent(TrackerCard, {
    name: 'tracker-card',
    meta: import.meta.url
});
