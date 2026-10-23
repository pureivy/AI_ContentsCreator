import React from 'react';
import { GalleryCompositions } from './Gallery';
import { PilotCompositions } from './PilotCheck';

export const GalleryRoot: React.FC = () => (
  <>
    <PilotCompositions />
    <GalleryCompositions />
  </>
);
