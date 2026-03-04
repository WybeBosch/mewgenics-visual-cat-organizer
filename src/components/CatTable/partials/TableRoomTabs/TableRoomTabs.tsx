import { joinClass } from '../../../../shared/utils/utils.tsx';
import type { TableRoomTabsProps } from './TableRoomTabs.types.ts';
import './TableRoomTabs.css';

export function TableRoomTabs({
	cats,
	rooms,
	activeRoom,
	setActiveRoom,
	sortedRooms,
	statFilters,
	clearStatFilters,
}: TableRoomTabsProps) {
	const roomList = (sortedRooms ?? [...rooms]).sort((a, b) => a.localeCompare(b));

	return (
		<>
			{roomList.length > 0 && (
				<nav className="table-room-tabs" aria-label="Room tabs">
					{roomList.map((room) => (
						<div key={room} className="item">
							<button
								className={joinClass('button', { active: activeRoom === room })}
								onClick={() => setActiveRoom(room)}
							>
								{room}{' '}
								<span className="count">
									({cats.filter((cat) => cat.room === room).length})
								</span>
							</button>
						</div>
					))}
					{Object.keys(statFilters).length > 0 && (
						<button className="clear-filters" onClick={clearStatFilters}>
							Clear Filters
						</button>
					)}
				</nav>
			)}
		</>
	);
}
