import { App } from './app';
import './styles.css';

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app element');

// Canvas text needs the display font loaded before the first frame, or pop-ups flash in a fallback.
void document.fonts.ready.then(() => {
  new App(root).go('home');
});
