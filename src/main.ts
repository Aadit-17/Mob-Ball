import { App } from './app';
import './styles.css';

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app element');

// Canvas text needs the HUD font loaded before the first frame, and no DOM text on home uses it yet.
const fonts = [
  document.fonts.load("700 12px 'Barlow Condensed'"),
  document.fonts.load("800 30px 'Barlow Condensed'"),
];
void Promise.allSettled(fonts)
  .then(() => document.fonts.ready)
  .then(() => {
    new App(root).go('home');
  });
