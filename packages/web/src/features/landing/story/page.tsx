import { useState } from 'react';
import { StoryCatalog, StoryScreensCatalog } from './catalog';
import { storyPalette } from './people';
import { StoryEyecatch, StoryScene, storyScenes } from './scenes';
import './story-assets.css';

const views = [{ id: 'assets', name: '素材一覧' }, { id: 'screens', name: '画面の見本' }, { id: 'scene', name: '場面の見本' }, { id: 'brand', name: 'ロゴ' }];

export default function StoryAssetsPage({ search = window.location.search }: { search?: string }) {
  const query = new URLSearchParams(search);
  const [view, setView] = useState(() => views.some(view => view.id === query.get('view')) ? query.get('view')! : 'assets');
  const [sceneId, setSceneId] = useState(() => storyScenes.find(scene => scene.id === query.get('scene'))?.id ?? 'office');
  const capture = query.get('capture') === '1';
  function update(view: string, scene: string) {
    const query = new URLSearchParams({ view, scene });
    window.history.replaceState(null, '', `/slides/story-assets?${query}`);
  }
  return <main className={`brand story-assets-page${capture ? ' story-capture' : ''}`} aria-label="しくみの素材見本">
    {!capture && <div className="story-toolbar">
      <nav aria-label="見本の種類">{views.map(item => <button key={item.id} type="button" aria-pressed={view === item.id}
        onClick={() => { setView(item.id); update(item.id, sceneId); }}>{item.name}</button>)}</nav>
      {view === 'scene' && <label>場面<select aria-label="場面" value={sceneId} onChange={event => {
        const scene = storyScenes.find(item => item.id === event.target.value) ?? storyScenes[0];
        setSceneId(scene.id); update(view, scene.id);
      }}>{storyScenes.map(scene => <option key={scene.id} value={scene.id}>{scene.place}</option>)}</select></label>}
    </div>}
    <div className="story-preview" data-view={view} data-palette="b" data-scene={sceneId}>
      {view === 'assets' ? <StoryCatalog palette={storyPalette} /> : view === 'screens' ? <StoryScreensCatalog />
        : view === 'brand' ? <StoryEyecatch /> : <StoryScene scene={sceneId} />}
    </div>
  </main>;
}
