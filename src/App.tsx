import { RelationshipGraph } from './components/RelationshipGraph/RelationshipGraph.jsx';
import { CatTable } from './components/CatTable/CatTable.jsx';
import { Header } from './components/Header/Header.tsx';
import { useMewgenicsCatsLogic } from './AppLogic.tsx';
import { useEnvironmentFavicon } from './shared/utils/faviconUtils.ts';

//eslint-disable-next-line no-console
console.log(`Mewgenics cat tracker v${import.meta.env.VITE_APP_VERSION}`);

export default function App() {
	useEnvironmentFavicon();

	const {
		cats,
		rooms,
		dataTimeLineText,
		activeRoom,
		setActiveRoom,
		savLoading,
		savError,
		hoveredCatId,
		setHoveredCatId,
		handleUploadSav,
		handleUploadJson,
		handleLoadDemo,
		handleClearData,
		isDemoLoaded,
		downloadPayload,
	} = useMewgenicsCatsLogic();

	return (
		<div id="app">
			<Header
				cats={cats}
				rooms={rooms}
				dataTimeLineText={dataTimeLineText}
				onUploadJson={handleUploadJson}
				onUploadSav={handleUploadSav}
				onLoadDemo={handleLoadDemo}
				onClearData={handleClearData}
				isDemoLoaded={isDemoLoaded}
				savLoading={savLoading}
				savError={savError}
				downloadPayload={downloadPayload}
			/>
			<main>
				<CatTable
					cats={cats}
					rooms={rooms}
					activeRoom={activeRoom}
					setActiveRoom={setActiveRoom}
				/>
				<RelationshipGraph
					cats={cats.filter((cat) => cat.room === activeRoom)}
					allCats={cats}
					hoveredCatId={hoveredCatId}
					setHoveredCatId={setHoveredCatId}
					activeRoom={activeRoom}
				/>
			</main>
		</div>
	);
}
