import { useState } from 'react';
import { StoryCatalog, StoryColorsCatalog, StoryScreensCatalog } from './catalog';
import { storyPalettes } from './people';
import { StoryEyecatch, StoryScene, storyScenes } from './scenes';
import './story-assets.css';

const views = [{ id: 'assets', name: '素材一覧' }, { id: 'screens', name: '画面の見本' }, { id: 'colors', name: '3配色の比較' }, { id: 'scene', name: '場面の見本' }, { id: 'brand', name: 'ロゴ' }];

export default function StoryAssetsPage({ search = window.location.search }: { search?: string }) {
  const query = new URLSearchParams(search);
  const [view, setView] = useState(() => views.some(view => view.id === query.get('view')) ? query.get('view')! : 'assets');
  const [paletteId, setPaletteId] = useState(() => storyPalettes.find(palette => palette.id === query.get('palette'))?.id ?? 'a');
  const [sceneId, setSceneId] = useState(() => storyScenes.find(scene => scene.id === query.get('scene'))?.id ?? 'office');
  const palette = storyPalettes.find(palette => palette.id === paletteId) ?? storyPalettes[0];
  const capture = query.get('capture') === '1';
  function update(view: string, palette: string, scene: string) {
    const query = new URLSearchParams({ view, palette, scene });
    window.history.replaceState(null, '', `/slides/story-assets?${query}`);
  }
  return <main className={`brand story-assets-page${capture ? ' story-capture' : ''}`} aria-label="しくみの素材見本">
    {!capture && <div className="story-toolbar">
      <nav aria-label="見本の種類">{views.map(item => <button key={item.id} type="button" aria-pressed={view === item.id}
        onClick={() => { setView(item.id); update(item.id, paletteId, sceneId); }}>{item.name}</button>)}</nav>
      <label>配色<select aria-label="配色" value={paletteId} onChange={event => {
        const palette = storyPalettes.find(item => item.id === event.target.value) ?? storyPalettes[0];
        setPaletteId(palette.id); update(view, palette.id, sceneId);
      }}>{storyPalettes.map(palette => <option key={palette.id} value={palette.id}>{palette.name}</option>)}</select></label>
      {view === 'scene' && <label>場面<select aria-label="場面" value={sceneId} onChange={event => {
        const scene = storyScenes.find(item => item.id === event.target.value) ?? storyScenes[0];
        setSceneId(scene.id); update(view, paletteId, scene.id);
      }}>{storyScenes.map(scene => <option key={scene.id} value={scene.id}>{scene.place}</option>)}</select></label>}
    </div>}
    <div className="story-preview" data-view={view} data-palette={paletteId} data-scene={sceneId}>
      {view === 'assets' ? <StoryCatalog palette={palette} /> : view === 'screens' ? <StoryScreensCatalog />
        : view === 'colors' ? <StoryColorsCatalog /> : view === 'brand' ? <StoryEyecatch /> : <StoryScene scene={sceneId} palette={palette} />}
    </div>
  </main>;
}
