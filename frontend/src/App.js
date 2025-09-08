import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { MOVIES } from './data/movies';
import MovieGrid from './components/MovieGrid';
import MovieDetail from './components/MovieDetail';
import BottomStatusBar from './components/BottomStatusBar';
import FloatingAdminPanel from './components/FloatingAdminPanel';
import Notifications from './components/Notifications';
import HeaderBanner from './components/HeaderBanner';
import LatestReviews from './components/LatestReviews';

function App() {
  // State for service statuses
  const [serviceStatus, setServiceStatus] = useState({
    backend: false,
    database: false,
    model: false,
    backendOverloaded: false
  });

  // State for current view
  const [selectedMovie, setSelectedMovie] = useState(null);
  const [reviews, setReviews] = useState({});
  const [latestReviews, setLatestReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [latestAnalysis, setLatestAnalysis] = useState(null); // Store latest sentiment analysis

  // State for notifications
  const [notifications, setNotifications] = useState([]);

  // State for frontend health simulation
  const [frontendHealthy, setFrontendHealthy] = useState(true);
  const [frontendOverloaded, setFrontendOverloaded] = useState(false);

  // Add notification helper
  const addNotification = (message, type = 'info') => {
    const id = Date.now();
    setNotifications(prev => [...prev, { id, message, type }]);
    
    // Auto remove after 5 seconds
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 5000);
  };

  // Check service statuses
  const checkServiceStatus = async () => {
    try {
      // Check backend health with shorter timeout
      const backendResponse = await axios.get('/api/admin/health', { timeout: 5000 });
      
      // If we get a response, backend is online - regardless of the status content
      // The response itself indicates the backend service is responding
      const backendHealthy = !!backendResponse.data && backendResponse.status === 200;
      
      console.log('✅ Backend health check successful:', {
        response: backendResponse.data,
        backendHealthy,
        database: backendResponse.data.database,
        modelServer: backendResponse.data.modelServer
      });
      
      setServiceStatus(prev => ({
        ...prev,
        backend: backendHealthy,
        database: backendResponse.data.database || false,
        model: backendResponse.data.modelServer || false,
        backendOverloaded: backendResponse.data.backendOverloaded || false
      }));
    } catch (err) {
      console.error('❌ Failed to check service status:', {
        message: err.message,
        code: err.code,
        status: err.response?.status,
        statusText: err.response?.statusText,
        url: '/api/admin/health'
      });
      
      // Add user notification for debugging
      if (err.code === 'ECONNREFUSED' || err.code === 'ERR_NETWORK') {
        console.error('🔧 Network connection failed - this usually means:');
        console.error('   1. Backend service is not running');
        console.error('   2. Frontend proxy configuration is incorrect');
        console.error('   3. Docker network connectivity issue');
      }
      
      setServiceStatus({
        backend: false,
        database: false,
        model: false,
        backendOverloaded: false
      });
    }
  };

  // Load latest reviews for homepage
  const loadLatestReviews = async () => {
    try {
      const response = await axios.get('/api/reviews/latest', { timeout: 5000 });
      setLatestReviews(response.data);
      console.log('Latest reviews loaded:', response.data.length);
    } catch (err) {
      console.log('Failed to load latest reviews:', err.message);
      setLatestReviews([]);
    }
  };

  // Load reviews for all movies
  const loadReviews = async () => {
    try {
      const reviewsData = {};
      
      // Load reviews for each movie with shorter timeout
      for (const movie of MOVIES) {
        try {
          const response = await axios.get(`/api/reviews/${movie.id}`, { timeout: 1000 });
          reviewsData[movie.id] = response.data;
        } catch (err) {
          console.log(`No reviews found for movie ${movie.id}`);
          reviewsData[movie.id] = [];
        }
      }
      
      setReviews(reviewsData);
    } catch (err) {
      console.error('Failed to load reviews:', err);
      addNotification('Failed to load reviews', 'error');
    }
  };

  // Submit a new review
  const submitReview = async (movieId, reviewText) => {
    try {
      setSubmitting(true);
      
      // Use the most reliable approach - GET request with query parameters
      // This bypasses all POST body parsing issues and proxy complications
      let response;
      try {
        // Approach 1: Simple GET request to a submit endpoint (most reliable)
        const encodedMovieId = encodeURIComponent(movieId);
        const encodedReviewText = encodeURIComponent(reviewText);
        response = await axios.get(`/api/reviews/submit-get?movieId=${encodedMovieId}&reviewText=${encodedReviewText}`, { timeout: 10000 });
      } catch (err) {
        console.warn('GET submit endpoint failed, trying POST with query params...', err.message);
        
        try {
          // Approach 2: POST with query parameters (fallback)
          response = await axios.post(`/api/reviews/submit?movieId=${encodeURIComponent(movieId)}&reviewText=${encodeURIComponent(reviewText)}`, {}, { timeout: 10000 });
        } catch (err2) {
          console.warn('POST query params failed, trying simple JSON...', err2.message);
          
          // Approach 3: Simple JSON with minimal data
          response = await axios.post('/api/reviews/submit', {
            movieId: movieId,
            reviewText: reviewText
          }, { 
            timeout: 5000,
            headers: {
              'Content-Type': 'application/json'
            }
          });
        }
      }
      
      console.log('✅ Review submission successful:', response.status, response.data);
      
      // Handle successful submission (HTTP 200 or 206)
      if (response.data?.review) {
        // Extract the sentiment analysis results
        const reviewData = response.data.review;
        const sentiment = reviewData.sentiment || 'unknown';
        const rating = reviewData.rating || 0;
        const sentimentScore = reviewData.sentimentScore || 0;
        
        // Store the latest analysis for display in the UI
        setLatestAnalysis({
          reviewText: reviewText,
          sentiment: sentiment,
          rating: rating,
          sentimentScore: sentimentScore,
          timestamp: new Date().toISOString(),
          movieId: movieId
        });
        
        // Show simple success notification
        addNotification('🎯 Review analyzed successfully! Check your results below.', 'success');
        
        // Try to reload reviews if database is working
        try {
          const updatedReviews = await axios.get(`/api/reviews/${movieId}`, { timeout: 5000 });
          setReviews(prev => ({
            ...prev,
            [movieId]: updatedReviews.data
          }));
        } catch (loadErr) {
          console.warn('Failed to reload reviews (database likely down), but sentiment analysis was successful');
          
          // Since database is down, add the analyzed review to the local state temporarily
          // so the user can see their sentiment analysis result immediately
          const tempReview = {
            reviewText: reviewText,
            sentiment: sentiment,
            rating: rating,
            sentimentScore: sentimentScore,
            timestamp: new Date().toISOString(),
            id: 'temp-' + Date.now()
          };
          
          setReviews(prev => ({
            ...prev,
            [movieId]: [...(prev[movieId] || []), tempReview]
          }));
        }
      } else {
        addNotification('Review submitted successfully!', 'success');
      }
      
      return true;
    } catch (err) {
      console.error('Failed to submit review:', err);
      
      // Check if this is a partial success (HTTP 206 - sentiment analysis worked but database failed)
      if (err.response?.status === 206 && err.response?.data?.review) {
        // Review was analyzed but not saved
        const reviewData = err.response.data.review;
        const sentiment = reviewData.sentiment || 'unknown';
        const rating = reviewData.rating || 0;
        const sentimentScore = reviewData.sentimentScore || 0;
        
        console.log('✅ Partial success - review analyzed:', err.response.data);
        
        // Store the latest analysis for display in the UI
        setLatestAnalysis({
          reviewText: reviewText,
          sentiment: sentiment,
          rating: rating,
          sentimentScore: sentimentScore,
          timestamp: new Date().toISOString(),
          movieId: movieId
        });
        
        // Show simple warning notification
        addNotification('🎯 Review analyzed successfully! (Database unavailable - not saved)', 'warning');
        
        // Add the analyzed review to local state so user can see the result
        const tempReview = {
          reviewText: reviewText,
          sentiment: sentiment,
          rating: rating,
          sentimentScore: sentimentScore,
          timestamp: new Date().toISOString(),
          id: 'temp-' + Date.now()
        };
        
        setReviews(prev => ({
          ...prev,
          [movieId]: [...(prev[movieId] || []), tempReview]
        }));
        
        return true; // Consider this a success from UX perspective
      }
      
      // Handle other errors
      if (err.response?.data?.message) {
        addNotification(err.response.data.message, 'error');
      } else {
        addNotification('Failed to submit review - ' + (err.message || 'Unknown error'), 'error');
      }
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  // Frontend overload simulation - now calls server API
  const startFrontendOverload = async () => {
    try {
      const response = await axios.post('/admin/start-overload', {}, { timeout: 5000 });
      addNotification('🔥 Frontend server overload started - Container CPU/Memory stress', 'warning');
      setFrontendOverloaded(true);
      console.log('🔥 Server overload response:', response.data);
    } catch (err) {
      console.error('Failed to start server overload:', err);
      addNotification('Failed to start server overload', 'error');
    }
  };

  const stopFrontendOverload = async () => {
    try {
      const response = await axios.post('/admin/stop-overload', {}, { timeout: 5000 });
      addNotification('✅ Frontend server overload stopped - Performance restored', 'success');
      setFrontendOverloaded(false);
      console.log('✅ Server overload stopped:', response.data);
    } catch (err) {
      console.error('Failed to stop server overload:', err);
      addNotification('Failed to stop server overload', 'error');
    }
  };

  // Crash frontend container - now calls server API
  const crashFrontendApp = async () => {
    addNotification('💥 CRITICAL: Frontend container will crash in 3 seconds!', 'error');
    console.error('💥 FRONTEND CONTAINER CRASH INITIATED');
    
    try {
      const response = await axios.post('/admin/crash', {}, { timeout: 5000 });
      console.log('💥 Crash response:', response.data);
      
      // Show countdown
      let countdown = 3;
      const countdownInterval = setInterval(() => {
        countdown--;
        if (countdown > 0) {
          addNotification(`💥 Container crashing in ${countdown} second${countdown > 1 ? 's' : ''}...`, 'error');
        } else {
          clearInterval(countdownInterval);
          addNotification('💥 Container should crash now!', 'error');
        }
      }, 1000);
      
    } catch (err) {
      console.error('Failed to crash container:', err);
      addNotification('Failed to crash container - ' + (err.response?.data?.message || 'API unavailable'), 'error');
    }
  };

  // Toggle frontend health - now calls server API
  const toggleFrontendHealth = async (newHealthState) => {
    try {
      const response = await axios.post('/admin/toggle-health', {}, { timeout: 5000 });
      setFrontendHealthy(response.data.healthy);
      addNotification(response.data.message, response.data.healthy ? 'success' : 'warning');
      console.log('🏥 Health toggle response:', response.data);
    } catch (err) {
      console.error('Failed to toggle health:', err);
      addNotification('Failed to toggle health', 'error');
    }
  };

  // Handle movie selection
  const handleMovieSelect = (movie) => {
    setSelectedMovie(movie);
    setLatestAnalysis(null); // Clear previous analysis when switching movies
    addNotification(`Viewing ${movie.title}`, 'info');
  };

  const handleBackToMovies = () => {
    setSelectedMovie(null);
    setLatestAnalysis(null); // Clear analysis when going back to movies
  };

  // Initial load
  useEffect(() => {
    const initializeApp = async () => {
      setLoading(true);
      console.log('🚀 Initializing Movie Analyzer App...');
      
      // Set a maximum initialization timeout to prevent infinite loading
      const initTimeout = setTimeout(() => {
        console.warn('⚠️ App initialization taking longer than expected, showing UI anyway...');
        setLoading(false);
      }, 10000); // 10 second maximum wait
      
      try {
        // Check service status first (quick)
        console.log('🔍 Checking service status...');
        await Promise.race([
          checkServiceStatus(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Health check timeout')), 8000)
          )
        ]);
        console.log('✅ Service status check completed');
      } catch (error) {
        console.error('❌ Failed to check service status during initialization:', error);
        // Set default offline state if health check fails
        setServiceStatus({
          backend: false,
          database: false,
          model: false,
          backendOverloaded: false
        });
        
        // Show helpful message to user
        addNotification('⚠️ Backend services not responding - some features may be limited', 'warning');
      }
      
      // Clear the timeout and show the UI
      clearTimeout(initTimeout);
      setLoading(false);
      console.log('✅ App initialization completed, showing UI');
      
      // Load reviews in background (can be slow due to database being down)
      loadReviews().then(() => {
        console.log('📚 Reviews loaded in background');
      }).catch(err => {
        console.log('❌ Background review loading failed:', err.message);
      });

      // Load latest reviews for homepage
      loadLatestReviews().then(() => {
        console.log('📈 Latest reviews loaded in background');
      }).catch(err => {
        console.log('❌ Background latest reviews loading failed:', err.message);
      });
    };
    
    initializeApp();
  }, []);

  // Periodic status check
  useEffect(() => {
    const interval = setInterval(checkServiceStatus, 10000); // Check every 10 seconds
    return () => clearInterval(interval);
  }, []);

  // If frontend is unhealthy, show error page
  if (!frontendHealthy) {
    return (
      <>
        <div className="app-layout">
          <div className="main-content">
            <HeaderBanner />
            <div style={{
              background: 'rgba(255, 255, 255, 0.95)',
              borderRadius: '12px',
              padding: '3rem',
              textAlign: 'center',
              border: '2px solid #ef4444'
            }}>
              <h2 style={{ color: '#dc2626', marginBottom: '1rem' }}>
                🚫 Frontend Service Unavailable
              </h2>
              <p style={{ color: '#6b7280', marginBottom: '0.5rem' }}>
                The frontend service is currently marked as unhealthy.
              </p>
              <p style={{ color: '#6b7280', marginBottom: '1rem' }}>
                This is a simulated failure for demonstration purposes.
              </p>
              <div style={{
                background: '#fef3c7',
                border: '1px solid #f59e0b',
                borderRadius: '8px',
                padding: '1rem',
                fontSize: '0.9rem',
                color: '#92400e'
              }}>
                💡 <strong>Tip:</strong> Use the admin panel (⚙️ bottom right) to restore frontend health
              </div>
            </div>
          </div>
        </div>
        
        {/* Bottom Status Bar - Always visible */}
        <BottomStatusBar 
          serviceStatus={serviceStatus}
          frontendOverloaded={frontendOverloaded}
        />

        {/* Floating Admin Panel - ALWAYS accessible for recovery */}
        <FloatingAdminPanel
          serviceStatus={serviceStatus}
          frontendHealthy={frontendHealthy}
          frontendOverloaded={frontendOverloaded}
          onToggleFrontendHealth={toggleFrontendHealth}
          onStartFrontendOverload={startFrontendOverload}
          onStopFrontendOverload={stopFrontendOverload}
          onCrashFrontend={crashFrontendApp}
          onNotification={addNotification}
          onRefreshStatus={checkServiceStatus}
        />

        {/* Notifications - Always available */}
        <Notifications notifications={notifications} />
      </>
    );
  }

  return (
    <>
      <div className="app-layout">
        {/* Main Content */}
        <div className="main-content">
          {/* Header Banner */}
          <HeaderBanner />

          {/* Main Content Area */}
          {loading ? (
            <div style={{ 
              background: 'white',
              borderRadius: '12px',
              padding: '3rem',
              textAlign: 'center'
            }}>
              <div className="loading-spinner" style={{ marginRight: '0.5rem' }}></div>
              Loading movies and services...
            </div>
          ) : selectedMovie ? (
            // Movie Detail View
            <MovieDetail
              movie={selectedMovie}
              reviews={reviews[selectedMovie.id] || []}
              serviceStatus={serviceStatus}
              onSubmitReview={submitReview}
              onBack={handleBackToMovies}
              submitting={submitting}
              latestAnalysis={latestAnalysis}
            />
          ) : (
            // Movie Grid View
            <>
              <div style={{ 
                marginBottom: '2rem',
                textAlign: 'center'
              }}>
                <h2 style={{ 
                  color: 'white', 
                  marginBottom: '0.5rem',
                  textShadow: '2px 2px 4px rgba(0,0,0,0.3)'
                }}>
                  Choose a Movie to Review
                </h2>
                <p style={{ color: 'rgba(255, 255, 255, 0.9)' }}>
                  Click on any movie to view details and write reviews
                </p>
              </div>
              
              <MovieGrid 
                movies={MOVIES}
                onMovieSelect={handleMovieSelect}
              />

              {/* Latest Reviews Section */}
              <LatestReviews latestReviews={latestReviews} />
            </>
          )}
        </div>
      </div>

      {/* Bottom Status Bar - Always visible */}
      <BottomStatusBar 
        serviceStatus={serviceStatus}
        frontendOverloaded={frontendOverloaded}
      />

      {/* Floating Admin Panel */}
      <FloatingAdminPanel
        serviceStatus={serviceStatus}
        frontendHealthy={frontendHealthy}
        frontendOverloaded={frontendOverloaded}
        onToggleFrontendHealth={toggleFrontendHealth}
        onStartFrontendOverload={startFrontendOverload}
        onStopFrontendOverload={stopFrontendOverload}
        onCrashFrontend={crashFrontendApp}
        onNotification={addNotification}
        onRefreshStatus={checkServiceStatus}
      />

      {/* Notifications */}
      <Notifications notifications={notifications} />
    </>
  );
}

export default App; 