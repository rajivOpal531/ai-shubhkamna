import { useEffect, useState } from 'react';
import { JwtProvider, useJwt } from './context/JwtContext';
import { MissingJwt } from './components/MissingJwt';
import { ExitConfirm } from './components/ExitConfirm';
import { Landing } from './steps/Landing';
import { Tips } from './steps/Tips';
import { Capture } from './steps/Capture';
import { Processing } from './steps/Processing';
import { Preview } from './steps/Preview';
import { templates } from './data/templates';
import { getProfile } from './services/profile';
import { createPostByImageUrl, createPostWithFile } from './services/createPost';
import { redirectWithJwt } from './utils/redirect';
import { config } from './config';
import type { CompositeResult, Profile, Step } from './types';

const EMPTY_PROFILE: Profile = {
  username: '',
  email: '',
  mobileno: '',
  state: '',
  constituency: '',
  district: '',
};

function Flow() {
  const jwt = useJwt();
  const [step, setStep] = useState<Step>('landing');
  const [name, setName] = useState('');
  const [profile, setProfile] = useState<Profile>(EMPTY_PROFILE);
  const [templateId, setTemplateId] = useState(templates[0].id);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [composited, setComposited] = useState<CompositeResult | null>(null);
  const [wish, setWish] = useState('');
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [showExitConfirm, setShowExitConfirm] = useState(false);

  useEffect(() => {
    getProfile(jwt).then((fetched) => {
      setProfile(fetched);
      if (fetched.username) {
        setName(fetched.username);
      }
    });
  }, [jwt]);

  const selectedTemplate = templates.find((template) => template.id === templateId) ?? templates[0];

  function handleFileSelected(file: File) {
    setPhoto(file);
    setStep('processing');
  }

  function handleCaptured(blob: Blob) {
    setPhoto(blob);
    setStep('processing');
  }

  async function handlePost() {
    if (!composited) return;
    setPosting(true);
    setPostError(null);

    const result = composited.imageUrl
      ? await createPostByImageUrl({ jwt, text: wish, imageUrl: composited.imageUrl, templateId })
      : await createPostWithFile({ jwt, text: wish, imageBlob: composited.imageBlob as Blob });

    setPosting(false);

    if (result.ok) {
      redirectWithJwt(config.mediaWallUrl, jwt);
    } else {
      setPostError("We couldn't post your card. Please try again.");
    }
  }

  return (
    <>
      {step === 'landing' && (
        <Landing
          name={name}
          onNameChange={setName}
          selectedTemplateId={templateId}
          onSelectTemplate={setTemplateId}
          onCapture={() => setStep('tips')}
          onFileSelected={handleFileSelected}
          onBack={() => setShowExitConfirm(true)}
        />
      )}
      {step === 'tips' && <Tips onProceed={() => setStep('capture')} onBack={() => setShowExitConfirm(true)} />}
      {step === 'capture' && (
        <Capture onCaptured={handleCaptured} onBack={() => setStep('landing')} onUseUploadInstead={() => setStep('landing')} />
      )}
      {step === 'processing' && photo && (
        <Processing
          jwt={jwt}
          photo={photo}
          template={selectedTemplate}
          profile={{ ...profile, username: name }}
          onComposited={(result) => {
            setComposited(result);
            setStep('preview');
          }}
          onError={() => setStep('landing')}
        />
      )}
      {step === 'preview' && composited && (
        <Preview
          composited={composited}
          wish={wish}
          onWishChange={setWish}
          posting={posting}
          postError={postError}
          onRetake={() => setStep('landing')}
          onPost={handlePost}
        />
      )}
      {showExitConfirm && (
        <ExitConfirm
          onConfirm={() => redirectWithJwt(config.homeUrl, jwt)}
          onCancel={() => setShowExitConfirm(false)}
        />
      )}
    </>
  );
}

type AppProps = {
  search?: string;
};

export function App({ search = window.location.search }: AppProps) {
  return (
    <JwtProvider search={search} missingJwtFallback={<MissingJwt />}>
      <Flow />
    </JwtProvider>
  );
}
