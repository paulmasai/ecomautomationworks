begin;

insert into public.automation_settings (key, value, description)
values
  ('global_automation_enabled', 'false', 'Emergency switch for all outbound automation.'),
  ('posting_enabled', 'false', 'Allows approved scheduled posts to be published.'),
  ('comment_replies_enabled', 'false', 'Allows approved automated Facebook comment replies.'),
  ('messenger_replies_enabled', 'false', 'Allows approved automated Messenger replies.'),
  ('maintenance_mode', 'true', 'Stores inbound events while suppressing outbound actions.'),
  ('maximum_daily_posts', '4', 'Maximum automated Page posts per UTC day.'),
  ('maximum_comment_replies_per_post', '20', 'Maximum automated comment replies for one post.'),
  ('maximum_replies_per_customer', '2', 'Maximum automated comment replies to one customer.'),
  ('maximum_messenger_replies_per_conversation', '8', 'Maximum bot replies before human handoff.'),
  ('maximum_product_suggestions', '3', 'Maximum products returned by rule-based matching.'),
  ('maximum_image_size_bytes', '8388608', 'Maximum supported product image size.'),
  ('log_retention_days', '30', 'Recommended audit/failure log retention period.'),
  ('message_retention_days', '90', 'Recommended private message retention period.')
on conflict (key) do update
set value = excluded.value,
    description = excluded.description;

insert into public.automation_reference_values (category, value, label, sort_order)
values
  ('comment_intent', 'price', 'Price', 10),
  ('comment_intent', 'availability', 'Availability', 20),
  ('comment_intent', 'location', 'Location', 30),
  ('comment_intent', 'delivery', 'Delivery', 40),
  ('comment_intent', 'specifications', 'Specifications', 50),
  ('comment_intent', 'inbox_request', 'Inbox request', 60),
  ('comment_intent', 'human_support', 'Human support', 70),
  ('comment_intent', 'complaint', 'Complaint', 80),
  ('comment_intent', 'unknown', 'Unknown', 90),
  ('messenger_conversation_state', 'automation_active', 'Automation active', 10),
  ('messenger_conversation_state', 'human_required', 'Human required', 20),
  ('messenger_conversation_state', 'human_assigned', 'Human assigned', 30),
  ('messenger_conversation_state', 'resolved', 'Resolved', 40),
  ('messenger_conversation_state', 'closed', 'Closed', 50),
  ('facebook_post_status', 'draft', 'Draft', 10),
  ('facebook_post_status', 'pending_approval', 'Pending approval', 20),
  ('facebook_post_status', 'approved', 'Approved', 30),
  ('facebook_post_status', 'scheduled', 'Scheduled', 40),
  ('facebook_post_status', 'processing', 'Processing', 50),
  ('facebook_post_status', 'published', 'Published', 60),
  ('facebook_post_status', 'failed', 'Failed', 70),
  ('facebook_post_status', 'cancelled', 'Cancelled', 80)
on conflict (category, value) do update
set label = excluded.label,
    sort_order = excluded.sort_order,
    active = true;

insert into public.reply_templates (
  id, name, intent, channel, body, language, active, approval_status, version, variables
)
values
  (
    '10000000-0000-0000-0000-000000000001',
    'comment_price',
    'price',
    'facebook_comment',
    'The current price for {{product_name}} is KSh {{price}}. Please message us privately to confirm the latest availability.',
    'en', true, 'approved', 1, array['product_name', 'price']
  ),
  (
    '10000000-0000-0000-0000-000000000002',
    'comment_availability',
    'availability',
    'facebook_comment',
    '{{product_name}} is currently marked as {{availability}}. Please send us a private message so we can confirm before you visit or make payment.',
    'en', true, 'approved', 1, array['product_name', 'availability']
  ),
  (
    '10000000-0000-0000-0000-000000000003',
    'comment_delivery',
    'delivery',
    'facebook_comment',
    'We offer delivery within Nairobi and countrywide. Please send your location privately for the available delivery options.',
    'en', true, 'approved', 1, '{}'
  ),
  (
    '10000000-0000-0000-0000-000000000004',
    'comment_location',
    'location',
    'facebook_comment',
    'Please send us a private message and our team will share the current shop location and directions.',
    'en', true, 'approved', 1, '{}'
  ),
  (
    '10000000-0000-0000-0000-000000000005',
    'human_assistance',
    'human_support',
    'facebook_comment',
    'Thank you for contacting MobDeals Kenya. A member of our team will assist you directly.',
    'en', true, 'approved', 1, '{}'
  ),
  (
    '10000000-0000-0000-0000-000000000006',
    'messenger_greeting',
    'greeting',
    'messenger',
    'Hello. Welcome to MobDeals Kenya. Which product are you looking for today?',
    'en', true, 'approved', 1, '{}'
  ),
  (
    '10000000-0000-0000-0000-000000000007',
    'messenger_ask_budget',
    'budget',
    'messenger',
    'What budget range would you like us to work with?',
    'en', true, 'approved', 1, '{}'
  ),
  (
    '10000000-0000-0000-0000-000000000008',
    'messenger_ask_preferences',
    'preferences',
    'messenger',
    'Do you have a preferred RAM size, storage size, brand, or model?',
    'en', true, 'approved', 1, '{}'
  ),
  (
    '10000000-0000-0000-0000-000000000009',
    'messenger_no_match',
    'product_interest',
    'messenger',
    'I could not find a confirmed match from the current catalogue. A member of our team can help you directly.',
    'en', true, 'approved', 1, '{}'
  ),
  (
    '10000000-0000-0000-0000-000000000010',
    'messenger_human_handoff',
    'human_support',
    'messenger',
    'Thank you. A member of the MobDeals Kenya team will continue assisting you here.',
    'en', true, 'approved', 1, '{}'
  )
on conflict (name, version) do nothing;

insert into public.reply_rules (
  id, name, intent, channel, template_id, priority, match_terms, requires_human, active
)
values
  (
    '20000000-0000-0000-0000-000000000001',
    'comment_price_terms', 'price', 'facebook_comment',
    '10000000-0000-0000-0000-000000000001', 10,
    array['price', 'how much', 'cost'], false, true
  ),
  (
    '20000000-0000-0000-0000-000000000002',
    'comment_availability_terms', 'availability', 'facebook_comment',
    '10000000-0000-0000-0000-000000000002', 20,
    array['available', 'still available', 'in stock'], false, true
  ),
  (
    '20000000-0000-0000-0000-000000000003',
    'comment_complaint_terms', 'complaint', 'facebook_comment',
    null, 1,
    array['refund', 'fraud', 'scam', 'warranty', 'complaint', 'payment issue'], true, true
  )
on conflict (name) do nothing;

insert into public.products (
  id, name, brand, model, category, processor, ram, storage, description,
  price, currency, stock_quantity, stock_status, product_condition, active
)
values (
  '30000000-0000-0000-0000-000000000001',
  'Example Laptop — replace before launch',
  'Example Brand',
  'Example Model',
  'Laptop',
  'Example Processor',
  '8 GB',
  '256 GB SSD',
  'Safe seed record for testing Supabase Studio workflows only.',
  50000,
  'KES',
  0,
  'out_of_stock',
  'example',
  false
)
on conflict (id) do nothing;

insert into public.facebook_posts (
  id, product_id, caption, post_type, status, approval_status
)
values (
  '40000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  'Example unpublished post. Replace this text before approval.',
  'text',
  'draft',
  'pending'
)
on conflict (id) do nothing;

commit;
