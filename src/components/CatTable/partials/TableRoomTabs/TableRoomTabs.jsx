import { joinClass } from '../../../../shared/utils/utils.jsx';
import './TableRoomTabs.css';

export function TableRoomTabs({
	cats,
	rooms,
	activeRoom,
	setActiveRoom,
	sortedRooms,
	statFilters,
	clearStatFilters,
}) {
	// Always sort rooms alphabetically for tab rendering
	sortedRooms = [...rooms].sort((a, b) => a.localeCompare(b));

	return (
		<>
			{sortedRooms.length > 0 && (
				<nav className="table-room-tabs" aria-label="Room tabs">
					{sortedRooms.map((room) => (
						<div key={room} className="item">
							<button
								className={joinClass('button', { active: activeRoom === room })}
								onClick={() => setActiveRoom(room)}
							>
								{room}{' '}
								<span className="count">
									({cats.filter((c) => c.room === room).length})
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
