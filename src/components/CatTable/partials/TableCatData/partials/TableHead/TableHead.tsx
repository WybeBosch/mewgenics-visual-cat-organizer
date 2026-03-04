import { useState } from 'react';
import { joinClass } from '../../../../../../shared/utils/utils.tsx';
import type { TableHeadProps } from './TableHead.types.ts';
import './TableHead.css';

export function TableHead({
	columns,
	handleSort,
	sortCol,
	sortAsc,
	searchQuery,
	onSearchChange,
	onSearchSubmit,
	statFilters,
	setStatFilter,
}: TableHeadProps) {
	const [hoveredColumn, setHoveredColumn] = useState<string | null>(null);

	return (
		<thead>
			<tr className="table-head">
				{columns.map((column, index) => {
					const isLeftAlignedTooltip = index < 2;
					const isRightAlignedTooltip = index === columns.length - 1;
					const isSortable = !column.isStatic;
					const isSorted = sortCol === column.key;
					const textAlignClass = column.key === 'name' ? 'left' : '';
					const staticClass = isSortable ? '' : 'static';
					const sortedClass = isSorted ? 'sorted' : '';
					const tooltipAlignClass = isLeftAlignedTooltip
						? 'left'
						: isRightAlignedTooltip
							? 'right'
							: '';
					const tooltipWidthClass = column.key === 'partner-room' ? 'wide' : '';
					const columnClass = `col-${column.key}`;
					const statClass = column.isStat ? 'col-stat' : '';
					const hasFilter = column.isStat && statFilters[column.key] != null;
					const hasFilterClass = hasFilter ? 'has-filter' : '';

					return (
						<th
							key={column.key}
							className={joinClass(
								'cell',
								columnClass,
								statClass,
								textAlignClass,
								staticClass,
								sortedClass,
								hasFilterClass
							)}
							onMouseEnter={() => setHoveredColumn(column.key)}
							onMouseLeave={() => setHoveredColumn(null)}
							onClick={isSortable ? () => handleSort(column.key) : undefined}
						>
							{hasFilter && (
								<button
									type="button"
									className="filter-clear"
									onClick={(event) => {
										event.stopPropagation();
										setStatFilter(column.key, null);
									}}
								>
									×
								</button>
							)}
							{column.key === 'name' ? (
								<input
									type="text"
									className="search-input"
									placeholder="Search name..."
									value={searchQuery}
									onChange={(event) => onSearchChange(event.target.value)}
									onKeyDown={(event) => {
										if (event.key === 'Enter') onSearchSubmit(searchQuery);
									}}
									onClick={(event) => event.stopPropagation()}
								/>
							) : (
								column.label
							)}
							{isSorted && (
								<span className="sort-indicator">{sortAsc ? '▲' : '▼'}</span>
							)}
							{hoveredColumn === column.key && column.isStat && (
								<div
									className={joinClass(
										'tooltip',
										'stat-filter',
										tooltipAlignClass
									)}
								>
									<input
										type="text"
										className="filter-input"
										placeholder="1-9"
										maxLength={1}
										value={statFilters[column.key] ?? ''}
										onChange={(event) => {
											const value = event.target.value;
											if (value === '') {
												setStatFilter(column.key, null);
											} else if (/^[1-9]$/.test(value)) {
												setStatFilter(column.key, Number(value));
											}
										}}
										onClick={(event) => event.stopPropagation()}
									/>
								</div>
							)}
							{hoveredColumn === column.key &&
								!column.isStat &&
								column.key !== 'name' &&
								column.tooltip && (
									<div
										className={joinClass(
											'tooltip',
											tooltipAlignClass,
											tooltipWidthClass
										)}
									>
										{column.tooltip}
									</div>
								)}
						</th>
					);
				})}
			</tr>
		</thead>
	);
}
