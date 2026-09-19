export const mockTemplates = {
	templates: [
		{
			name: 'aws-template.yml',
			provider: 'aws',
			description: 'Test AWS template',
			architecture: [
				{
					name: 'Splunk',
					os_type: 'linux',
					instance_type: 't2.large',
					ip_last_octet: 10,
					roles: ['splunk_server'],
				},
			],
		},
		{
			name: 'azure-template.yml',
			provider: 'azure',
			description: 'Test Azure template',
			architecture: [],
		},
	],
	providerAvailability: {
		aws: { available: true, cli_command: 'aws' },
		azure: { available: true, cli_command: 'az' },
	},
};

export const mockAttackRanges = {
	attack_ranges: [
		{
			attack_range_id: 'test-123',
			attack_range_name: 'Test Range',
			status: 'running',
			template_name: 'aws-template',
			type: 'aws',
			created_time: '2024-01-01T00:00:00Z',
		},
		{
			attack_range_id: 'test-456',
			attack_range_name: 'Building Range',
			status: 'build_lab',
			template_name: 'azure-template',
			type: 'azure',
			created_time: '2024-01-02T00:00:00Z',
		},
	],
};

export const mockAttackRangeDetail = {
	attack_range_id: 'test-123',
	attack_range_name: 'Test Range',
	status: 'running',
	template_name: 'aws-template',
	type: 'aws',
	created_time: '2024-01-01T00:00:00Z',
	start_time: '2024-01-01T00:10:00Z',
	router_public_ip: '1.2.3.4',
	result: {
		architecture: [
			{
				name: 'Splunk',
				os_type: 'linux',
				instance_type: 't2.large',
				ip_last_octet: 10,
				roles: ['splunk_server'],
			},
		],
		default_credentials: [
			{
				service: 'splunk',
				username: 'admin',
				password: 'testpassword',
			},
		],
	},
};
