import type { Template } from '../types';
import card1 from '../assets/templates/pm-birthday-AI-Shubhkamna-card-1.jpg';
import card2 from '../assets/templates/pm-birthday-AI-Shubhkamna-card-2.jpg';
import card3 from '../assets/templates/pm-birthday-AI-Shubhkamna-card-3.jpg';
import card4 from '../assets/templates/pm-birthday-AI-Shubhkamna-card-4.jpg';
import card5 from '../assets/templates/pm-birthday-AI-Shubhkamna-card-5.jpg';
import card6 from '../assets/templates/pm-birthday-AI-Shubhkamna-card-6.jpg';
import card8 from '../assets/templates/pm-birthday-AI-Shubhkamna-card-8.jpg';
import card9 from '../assets/templates/pm-birthday-AI-Shubhkamna-card-9.jpg';
import card10 from '../assets/templates/pm-birthday-AI-Shubhkamna-card-10.jpg';
import card11 from '../assets/templates/pm-birthday-AI-Shubhkamna-card-11.jpg';
import card15 from '../assets/templates/pm-birthday-AI-Shubhkamna-card-15.jpg';
// Clean (no avatar-placeholder silhouette) versions — used as the Adjust-photo background.
import clean1 from '../assets/templates/clean/card-1.jpg';
import clean2 from '../assets/templates/clean/card-2.jpg';
import clean3 from '../assets/templates/clean/card-3.jpg';
import clean4 from '../assets/templates/clean/card-4.jpg';
import clean5 from '../assets/templates/clean/card-5.jpg';
import clean6 from '../assets/templates/clean/card-6.jpg';
import clean8 from '../assets/templates/clean/card-8.jpg';
import clean9 from '../assets/templates/clean/card-9.jpg';
import clean10 from '../assets/templates/clean/card-10.jpg';
import clean11 from '../assets/templates/clean/card-11.jpg';
import clean15 from '../assets/templates/clean/card-15.jpg';

// ids 7, 12, 13, 14 are intentionally absent — not in the approved Dropbox set, see design spec "Templates"
export const templates: Template[] = [
  { id: 'card-1', image: card1, cleanImage: clean1 },
  { id: 'card-2', image: card2, cleanImage: clean2 },
  { id: 'card-3', image: card3, cleanImage: clean3 },
  { id: 'card-4', image: card4, cleanImage: clean4 },
  { id: 'card-5', image: card5, cleanImage: clean5 },
  { id: 'card-6', image: card6, cleanImage: clean6 },
  { id: 'card-8', image: card8, cleanImage: clean8 },
  { id: 'card-9', image: card9, cleanImage: clean9 },
  { id: 'card-10', image: card10, cleanImage: clean10 },
  { id: 'card-11', image: card11, cleanImage: clean11 },
  { id: 'card-15', image: card15, cleanImage: clean15 },
];
