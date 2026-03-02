import { TableRoomTabs } from './partials/TableRoomTabs/TableRoomTabs';
import { TableCatData } from './partials/TableCatData/TableCatData';

import { CatTableLogic } from './CatTableLogic';

export function CatTable({ cats, rooms, activeRoom, setActiveRoom }) {
	const {
		hoveredCatId,
		setHoveredCatId,
		handleSort,
		sorted,
		aggroColor,
		totalStat,
		sortCol,
		sortAsc,
		statFilters,
		setStatFilter,
		clearStatFilters,
	} = CatTableLogic({ cats, activeRoom });
	return (
		<>
			<TableRoomTabs
				cats={cats}
				rooms={rooms}
				activeRoom={activeRoom}
				setActiveRoom={setActiveRoom}
				statFilters={statFilters}
				clearStatFilters={clearStatFilters}
			/>
			<TableCatData
				cats={cats}
				activeRoom={activeRoom}
				setActiveRoom={setActiveRoom}
				totalStat={totalStat}
				aggroColor={aggroColor}
				hoveredCatId={hoveredCatId}
				setHoveredCatId={setHoveredCatId}
				handleSort={handleSort}
				sortCol={sortCol}
				sortAsc={sortAsc}
				sorted={sorted}
				statFilters={statFilters}
				setStatFilter={setStatFilter}
			/>
		</>
	);
}
