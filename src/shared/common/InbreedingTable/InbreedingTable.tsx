import './InbreedingTable.css';

export function InbreedingTable() {
	return (
		<table className="inbreeding-table">
			<thead>
				<tr>
					<th>Pairing type</th>
					<th>Coefficient</th>
				</tr>
			</thead>
			<tbody>
				<tr>
					<td>Unrelated</td>
					<td>0%</td>
				</tr>
				<tr>
					<td>Cousins</td>
					<td>6.25%</td>
				</tr>
				<tr>
					<td>Half-siblings</td>
					<td>12.5%</td>
				</tr>
				<tr>
					<td>Grandparent–grandchild</td>
					<td>12.5%</td>
				</tr>
				<tr>
					<td>Full siblings</td>
					<td>25%</td>
				</tr>
				<tr>
					<td>Parent–child</td>
					<td>25%</td>
				</tr>
			</tbody>
		</table>
	);
}

export default InbreedingTable;
