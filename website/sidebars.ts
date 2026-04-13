import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

/**
 * Sidebar skeleton matching the postalservice content plan.
 *
 * Only the intro page exists at this point.  Phase B docs vertical will
 * populate the remaining categories and leaf pages.
 */
const sidebars: SidebarsConfig = {
  docsSidebar: [
    'intro',
    // The following categories will be populated by the docs vertical:
    // - migrating-from-axios
    // - guides (how-tos)
    // - security
    // - cookbook
    // - reference (API docs)
    // - roadmap
  ],
};

export default sidebars;
