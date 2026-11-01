import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStatus, useLogout } from '../services/auth/authHooks.ts';
import MyFinSidebar from './MyFinSidebar.tsx';
import '../app.css';
import {
  alpha,
  AppBar,
  Backdrop,
  Box,
  CircularProgress,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  useTheme,
} from '@mui/material';
import Chip from '@mui/material/Chip';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import PaletteOutlinedIcon from '@mui/icons-material/PaletteOutlined';
import CheckIcon from '@mui/icons-material/Check';
import {
  AccountCircleOutlined,
  HelpOutlineOutlined,
  LogoutOutlined,
} from '@mui/icons-material';
import { useContext, useEffect, useRef, useState } from 'react';
import { ColorModeContext } from '../providers/MyFinThemeProvider.tsx';
import {
  MY_FIN_THEME_LABEL_KEYS,
  MY_FIN_THEME_NAMES,
  MY_FIN_THEME_PALETTE_PREVIEWS,
} from '../theme';
import TopSummary from './TopSummary.tsx';
import { ROUTE_PROFILE, ROUTE_AUTH, ROUTE_HELP } from '../providers/RoutesProvider.tsx';
import { useTranslation } from 'react-i18next';
import PlannedMatchPromptHost from '../features/transactions/PlannedMatchPromptHost.tsx';
import { useUserData } from '../providers/UserProvider.tsx';
import AuthServices from '../services/auth/authServices.ts';

const PrivateRoute = () => {
  const colorMode = useContext(ColorModeContext);
  const theme = useTheme();
  const authStatus = useAuthStatus(true);
  const logout = useLogout();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const { userSessionData } = useUserData();
  const [themeMenuAnchor, setThemeMenuAnchor] =
    useState<null | HTMLElement>(null);

  const [isRecheckingSession, setRecheckingSession] = useState(false);
  const recheckInFlight = useRef(false);

  const isDemoAccount = userSessionData?.is_demo === true;
  const isThemeMenuOpen = Boolean(themeMenuAnchor);

  function openThemeMenu(event: React.MouseEvent<HTMLElement>) {
    setThemeMenuAnchor(event.currentTarget);
  }

  function closeThemeMenu() {
    setThemeMenuAnchor(null);
  }

  function goToProfile() {
    navigate(ROUTE_PROFILE);
  }

  function doLogout() {
    logout();
  }

  useEffect(() => {
    // every time the location (route) change, check if session is still valid
    authStatus.refetch();
  }, [location.pathname]);

  useEffect(() => {
    // Coming back to the tab (after any time away): confirm the session is still valid before the
    // user can interact. `focus` and `visibilitychange` often fire together, so one check at a time.
    async function recheckSession() {
      if (document.visibilityState !== 'visible' || recheckInFlight.current) {
        return;
      }
      recheckInFlight.current = true;
      setRecheckingSession(true);
      try {
        if (!(await AuthServices.validateSession())) {
          authStatus.refetch(); // the effect below sends the user to the login screen
        }
      } catch (error) {
        // The server answered with a rejection (e.g. 401): treat the session as invalid.
        // No response at all (network down) is not a logout; the page stays as it is.
        if ((error as { response?: unknown })?.response) {
          authStatus.refetch();
        }
      } finally {
        recheckInFlight.current = false;
        setRecheckingSession(false);
      }
    }

    window.addEventListener('focus', recheckSession);
    document.addEventListener('visibilitychange', recheckSession);
    return () => {
      window.removeEventListener('focus', recheckSession);
      document.removeEventListener('visibilitychange', recheckSession);
    };
  }, [authStatus.refetch]);

  useEffect(() => {
    // Navigate to the authentication route if the user is no longer authenticated
    if (!authStatus.isFetching && !authStatus.isAuthenticated) {
      navigate(ROUTE_AUTH);
    }
  }, [authStatus.isFetching, authStatus.isAuthenticated, navigate]);

  return (
    <>
      {authStatus.isSuccess && (
        <Box sx={{ display: 'flex', height: '100dvh', overflow: 'hidden' }}>
          <MyFinSidebar />
          {/* Fills what the sidebar leaves (a 100vw main next to the sidebar overflowed the window) */}
          <main
            style={{
              flex: 1,
              minWidth: 0,
              height: '100%',
              overflowY: 'auto',
              overflowX: 'hidden',
            }}
          >
            <AppBar
              position="static"
              color="transparent"
              elevation={0}
              sx={{ boxShadow: 'none' }}
            >
              <Box
                display="flex"
                justifyContent="space-between"
                p={2}
                alignItems="center"
              >
                <Box justifyContent="flex-start">
                  <TopSummary />
                </Box>
                <Box display="flex" alignItems="center">
                  {isDemoAccount && (
                    <Chip
                      icon={<InfoOutlinedIcon />}
                      label={t('topBar.demoAccountBadge')}
                      size="small"
                      title={t('topBar.demoAccountNotice')}
                      sx={{
                        mr: 1,
                        fontWeight: 600,
                        fontSize: '0.72rem',
                        backgroundColor: alpha(
                          theme.palette.primary.main,
                          theme.palette.mode === 'dark' ? 0.2 : 0.1,
                        ),
                        color: theme.palette.primary.main,
                        border:
                          '1px solid ' +
                          alpha(theme.palette.primary.main, 0.25),
                        '& .MuiChip-icon': {
                          color: 'inherit',
                          fontSize: '0.9rem',
                        },
                      }}
                    />
                  )}
                  <IconButton
                    id="theme-menu-button"
                    size="large"
                    aria-label={t('topBar.changeTheme')}
                    aria-controls={isThemeMenuOpen ? 'theme-menu' : undefined}
                    aria-haspopup="menu"
                    aria-expanded={isThemeMenuOpen ? 'true' : undefined}
                    onClick={openThemeMenu}
                    color="inherit"
                  >
                    <PaletteOutlinedIcon />
                  </IconButton>
                  <Menu
                    id="theme-menu"
                    anchorEl={themeMenuAnchor}
                    open={isThemeMenuOpen}
                    onClose={closeThemeMenu}
                    MenuListProps={{
                      'aria-labelledby': 'theme-menu-button',
                    }}
                  >
                    {MY_FIN_THEME_NAMES.map((themeName) => {
                      const isSelected = colorMode.themeName === themeName;
                      const [backgroundColor, surfaceColor, primaryColor, secondaryColor] = MY_FIN_THEME_PALETTE_PREVIEWS[themeName];
                      return (
                        <MenuItem
                          key={themeName}
                          selected={isSelected}
                          onClick={() => {
                            colorMode.setColorMode(themeName);
                            closeThemeMenu();
                          }}
                        >
                          <ListItemIcon sx={{ minWidth: 32 }}>
                            {isSelected && <CheckIcon fontSize="small" />}
                          </ListItemIcon>
                          <Box
                            component="span"
                            aria-hidden
                            sx={{
                              width: 22,
                              height: 22,
                              borderRadius: '50%',
                              flexShrink: 0,
                              border: 1,
                              borderColor: 'background.paper',
                              background: `conic-gradient(${backgroundColor} 0deg 90deg, ${surfaceColor} 90deg 180deg, ${primaryColor} 180deg 270deg, ${secondaryColor} 270deg 360deg)`,
                              mr: 1,
                            }}
                          />
                          <ListItemText
                            primary={t(MY_FIN_THEME_LABEL_KEYS[themeName])}
                          />
                        </MenuItem>
                      );
                    })}
                  </Menu>
                  <IconButton
                    size="large"
                    aria-label="help"
                    onClick={() => navigate(ROUTE_HELP)}
                    color="inherit"
                  >
                    <HelpOutlineOutlined />
                  </IconButton>
                  <IconButton
                    size="large"
                    aria-label="profile"
                    aria-controls="menu-appbar"
                    aria-haspopup="false"
                    onClick={goToProfile}
                    color="inherit"
                  >
                    <AccountCircleOutlined />
                  </IconButton>
                  <IconButton
                    size="large"
                    aria-label="logout"
                    aria-controls="menu-appbar"
                    aria-haspopup="false"
                    onClick={doLogout}
                    color="inherit"
                  >
                    <LogoutOutlined />
                  </IconButton>
                </Box>
              </Box>
            </AppBar>
            <Outlet />
            <PlannedMatchPromptHost />
            <Backdrop
              open={isRecheckingSession}
              sx={{ color: '#fff', zIndex: (t) => t.zIndex.modal + 2 }}
            >
              <CircularProgress color="inherit" />
            </Backdrop>
          </main>
        </Box>
      )}
    </>
  );
};

export default PrivateRoute;
