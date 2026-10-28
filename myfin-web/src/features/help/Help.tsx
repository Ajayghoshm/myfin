import { ExpandMore, SearchOutlined } from '@mui/icons-material';
import { useTheme } from '@mui/material';
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import InputAdornment from '@mui/material/InputAdornment';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../../components/PageHeader.tsx';
import {
  FIRST_WEEK,
  GLOSSARY,
  HELP_SECTIONS,
  type HelpSection,
} from './helpContent.ts';

const matches = (query: string, ...texts: string[]) =>
  texts.some((text) => text.toLowerCase().includes(query));

const sectionMatches = (s: HelpSection, query: string) =>
  matches(query, s.title, s.summary, ...s.howTo, ...s.rules);

/** In-app guide: a first-week walkthrough plus a searchable reference. */
const Help = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const [tab, setTab] = useState(0);
  const [search, setSearch] = useState('');
  const query = search.trim().toLowerCase();

  const sections = useMemo(
    () => HELP_SECTIONS.filter((s) => !query || sectionMatches(s, query)),
    [query],
  );
  const glossary = useMemo(
    () =>
      GLOSSARY.filter((g) => !query || matches(query, g.term, g.meaning)),
    [query],
  );
  const groups = [...new Set(sections.map((s) => s.group))];

  return (
    <Paper elevation={0} sx={{ p: theme.spacing(2), m: theme.spacing(2) }}>
      <PageHeader
        title="Help"
        subtitle="Get started in your first week, or look up how something works"
      />
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label="First week" />
        <Tab label="Reference" />
      </Tabs>

      {tab === 0 && (
        <Stack spacing={1.5}>
          {FIRST_WEEK.map((step, i) => (
            <Box key={step.title} display="flex" gap={2} alignItems="flex-start">
              <Typography
                variant="h6"
                color="primary"
                sx={{ minWidth: 28, textAlign: 'right' }}
              >
                {i + 1}
              </Typography>
              <Box flex={1}>
                <Typography fontWeight="bold">{step.title}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {step.where}
                </Typography>
                <Typography variant="body2">{step.why}</Typography>
              </Box>
              <Button size="small" onClick={() => navigate(step.route)}>
                Open
              </Button>
            </Box>
          ))}
        </Stack>
      )}

      {tab === 1 && (
        <>
          <TextField
            fullWidth
            size="small"
            placeholder="Search the guide"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchOutlined />
                  </InputAdornment>
                ),
              },
            }}
            sx={{ mb: 2 }}
          />
          {groups.map((group) => (
            <Box key={group} mb={2}>
              <Typography variant="subtitle1" fontWeight="bold" mb={1}>
                {group}
              </Typography>
              {sections
                .filter((s) => s.group === group)
                .map((s) => (
                  <Accordion
                    key={s.id}
                    disableGutters
                    defaultExpanded={Boolean(query)}
                  >
                    <AccordionSummary expandIcon={<ExpandMore />}>
                      <Box>
                        <Typography fontWeight="bold">{s.title}</Typography>
                        <Typography variant="body2" color="text.secondary">
                          {s.summary}
                        </Typography>
                      </Box>
                    </AccordionSummary>
                    <AccordionDetails>
                      <Typography fontWeight="bold" variant="body2">
                        How to
                      </Typography>
                      <Box component="ol" sx={{ mt: 0.5, pl: 3 }}>
                        {s.howTo.map((line) => (
                          <li key={line}>
                            <Typography variant="body2">{line}</Typography>
                          </li>
                        ))}
                      </Box>
                      <Typography fontWeight="bold" variant="body2">
                        How it works
                      </Typography>
                      <Box component="ul" sx={{ mt: 0.5, pl: 3 }}>
                        {s.rules.map((line) => (
                          <li key={line}>
                            <Typography variant="body2">{line}</Typography>
                          </li>
                        ))}
                      </Box>
                      {s.route && (
                        <Button
                          size="small"
                          onClick={() => navigate(s.route as string)}
                        >
                          Open {s.title}
                        </Button>
                      )}
                    </AccordionDetails>
                  </Accordion>
                ))}
            </Box>
          ))}
          {glossary.length > 0 && (
            <Box>
              <Typography variant="subtitle1" fontWeight="bold" mb={1}>
                Glossary
              </Typography>
              <Stack spacing={1}>
                {glossary.map((g) => (
                  <Typography key={g.term} variant="body2">
                    <b>{g.term}.</b> {g.meaning}
                  </Typography>
                ))}
              </Stack>
            </Box>
          )}
          {sections.length === 0 && glossary.length === 0 && (
            <Typography color="text.secondary">
              Nothing matches "{search}".
            </Typography>
          )}
        </>
      )}
    </Paper>
  );
};

export default Help;
