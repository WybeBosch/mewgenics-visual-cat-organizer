import { InbreedingTable } from '../../../../shared/common/InbreedingTable/InbreedingTable.tsx';
import './RelationshipLegendBar.css';

function RelationshipLegendBar({ hiddenLineTypes, onToggle }) {
	const renderToggleItem = ({ key, lineClassName, label, strokeWidth, strokeDasharray }) => (
		<span className="item" key={key}>
			<button
				type="button"
				onClick={() => onToggle(key)}
				className={hiddenLineTypes.has(key) ? 'disabled' : ''}
				aria-pressed={!hiddenLineTypes.has(key)}
			>
				<svg width="32" height="8">
					<line
						className={lineClassName}
						x1="0"
						y1="4"
						x2="30"
						y2="4"
						strokeWidth={strokeWidth}
						strokeDasharray={strokeDasharray}
					/>
				</svg>
				<span className="label">{label}</span>
			</button>
		</span>
	);

	return (
		<aside className="graph-legend" aria-label="Relationship legend">
			{renderToggleItem({
				key: 'love',
				lineClassName: 'legend-line-love',
				label: 'Loves',
				strokeWidth: 2,
			})}
			{renderToggleItem({
				key: 'hate',
				lineClassName: 'legend-line-hate',
				label: 'Hates',
				strokeWidth: 2,
				strokeDasharray: '6,4',
			})}
			<span className="item">
				<svg width="16" height="16">
					<circle className="legend-node-female" cx="8" cy="8" r="6" strokeWidth="1.5" />
				</svg>
				<span className="label">Female</span>
			</span>
			<span className="item">
				<svg width="16" height="16">
					<circle className="legend-node-male" cx="8" cy="8" r="6" strokeWidth="1.5" />
				</svg>
				<span className="label">Male</span>
			</span>
			<span className="item">
				<svg width="16" height="16">
					<circle className="legend-node-herm" cx="8" cy="8" r="6" strokeWidth="1.5" />
				</svg>
				<span className="label">Herm</span>
			</span>
			{renderToggleItem({
				key: 'parent',
				lineClassName: 'legend-line-parent',
				label: 'Parent',
				strokeWidth: 3,
			})}
			{renderToggleItem({
				key: 'grandparent',
				lineClassName: 'legend-line-grandparent',
				label: 'Grandparent',
				strokeWidth: 2,
				strokeDasharray: '6,3',
			})}
			{renderToggleItem({
				key: 'sibling',
				lineClassName: 'legend-line-sibling',
				label: 'Sibling',
				strokeWidth: 3,
			})}
			{renderToggleItem({
				key: 'related',
				lineClassName: 'legend-line-related',
				label: 'Related',
				strokeWidth: 2,
				strokeDasharray: '8,4',
			})}
			<span className="item inbreeding-legend-wrapper">
				<button
					type="button"
					onClick={() => onToggle('inbreeding')}
					className={hiddenLineTypes.has('inbreeding') ? 'disabled' : ''}
					aria-pressed={!hiddenLineTypes.has('inbreeding')}
				>
					<span className="label legend-label-inbreeding">
						0% - 25% Inbreeding chance
					</span>
				</button>
				<div className="inbreeding-tooltip">
					<InbreedingTable />
				</div>
			</span>
		</aside>
	);
}

export default RelationshipLegendBar;
